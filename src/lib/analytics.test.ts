import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { submissionEventProps } from "@/lib/analytics";

const SRC = fileURLToPath(new URL("..", import.meta.url));

// コメント本文・IP・名前・メール、および座標など個人や位置を特定しうるキー。
const PII_KEYS = new Set(
  [
    "comment",
    "comments",
    "ip",
    "iphash",
    "ip_hash",
    "clientip",
    "client_ip",
    "name",
    "username",
    "user_name",
    "email",
    "mail",
    "phone",
    "tel",
    "address",
    "lat",
    "lng",
    "latitude",
    "longitude",
  ].map((k) => k.toLowerCase()),
);

type TrackCall = {
  file: string;
  names: string[];
  keys: string[];
  propsSource: string;
};

function skipString(source: string, i: number): number {
  const quote = source[i];
  i += 1;
  if (quote === "`") {
    while (i < source.length) {
      if (source[i] === "\\") {
        i += 2;
        continue;
      }
      if (source[i] === "$" && source[i + 1] === "{") {
        i = skipBalanced(source, i + 1, "{", "}") + 1;
        continue;
      }
      if (source[i] === "`") return i + 1;
      i += 1;
    }
    return i;
  }
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

function skipBalanced(source: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIdx; i < source.length; i += 1) {
    const c = source[i];
    if (c === "'" || c === '"' || c === "`") {
      i = skipString(source, i) - 1;
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return source.length;
}

function splitTopLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let current = "";
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < args.length; i += 1) {
    const c = args[i];
    if (c === "'" || c === '"' || c === "`") {
      const next = skipString(args, i);
      current += args.slice(i, next);
      i = next - 1;
      continue;
    }
    if (c === "(") paren += 1;
    else if (c === ")") paren -= 1;
    else if (c === "{") brace += 1;
    else if (c === "}") brace -= 1;
    else if (c === "[") bracket += 1;
    else if (c === "]") bracket -= 1;
    else if (c === "," && paren === 0 && brace === 0 && bracket === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function eventNames(firstArg: string): string[] {
  const names: string[] = [];
  const re = /["']([A-Za-z0-9_]+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(firstArg))) names.push(match[1]);
  return names;
}

// オブジェクトリテラルのキーだけを拾う。スプレッド内の入れ子も対象。
function objectKeys(expr: string): string[] {
  const keys: string[] = [];
  type Frame = { paren: number; bracket: number; expectKey: boolean };
  const stack: Frame[] = [];
  let paren = 0;
  let bracket = 0;
  const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c);
  const isIdent = (c: string) => /[A-Za-z0-9_$]/.test(c);

  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    if (c === "'" || c === '"' || c === "`") {
      const start = i;
      i = skipString(expr, i) - 1;
      const top = stack.at(-1);
      if (top?.expectKey && paren === top.paren && bracket === top.bracket) {
        let j = i + 1;
        while (j < expr.length && /\s/.test(expr[j])) j += 1;
        if (expr[j] === ":") keys.push(expr.slice(start + 1, i));
      }
      continue;
    }
    if (c === "{") {
      stack.push({ paren, bracket, expectKey: true });
      continue;
    }
    if (c === "}") {
      stack.pop();
      continue;
    }
    if (c === "(") {
      paren += 1;
      continue;
    }
    if (c === ")") {
      paren -= 1;
      continue;
    }
    if (c === "[") {
      bracket += 1;
      continue;
    }
    if (c === "]") {
      bracket -= 1;
      continue;
    }
    const top = stack.at(-1);
    const inObject = top !== undefined && paren === top.paren && bracket === top.bracket;
    if (c === "," && inObject) {
      top.expectKey = true;
      continue;
    }
    if (c === ":" && inObject) {
      top.expectKey = false;
      continue;
    }
    if (c === "." && expr[i + 1] === "." && expr[i + 2] === "." && inObject) {
      top.expectKey = false;
      i += 2;
      continue;
    }
    if (top?.expectKey && inObject && isIdentStart(c)) {
      const start = i;
      i += 1;
      while (i < expr.length && isIdent(expr[i])) i += 1;
      const ident = expr.slice(start, i);
      let j = i;
      while (j < expr.length && /\s/.test(expr[j])) j += 1;
      const next = expr[j];
      if (next === ":" || next === "," || next === "}") keys.push(ident);
      i -= 1;
    }
  }
  return keys;
}

function collectTrackCalls(): TrackCall[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      files.push(path);
    }
  };
  walk(SRC);

  const calls: TrackCall[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    let from = 0;
    while (from < source.length) {
      const idx = source.indexOf("trackEvent(", from);
      if (idx === -1) break;
      const open = idx + "trackEvent".length;
      const close = skipBalanced(source, open, "(", ")");
      const args = splitTopLevelArgs(source.slice(open + 1, close));
      const propsSource = args[1] ?? "";
      calls.push({
        file: relative(SRC, file),
        names: eventNames(args[0] ?? ""),
        keys: propsSource ? objectKeys(propsSource) : [],
        propsSource,
      });
      from = close + 1;
    }
  }
  return calls;
}

const calls = collectTrackCalls();

describe("objectKeys", () => {
  it("短縮記法・ネスト・値の中の識別子を区別する", () => {
    expect(objectKeys("{ toiletId, ...(isReport ? {} : { rating, accessLevel }) }")).toEqual([
      "toiletId",
      "rating",
      "accessLevel",
    ]);
    expect(objectKeys('{ result: j.result ?? "pending" }')).toEqual(["result"]);
    expect(objectKeys('{ source: "header" }')).toEqual(["source"]);
    expect(objectKeys('{ toiletId: toilet.id, method: "clipboard" }')).toEqual([
      "toiletId",
      "method",
    ]);
    expect(objectKeys('{ comment: "本文", ip: "203.0.113.1", email: "a@b.c" }')).toEqual([
      "comment",
      "ip",
      "email",
    ]);
  });
});

describe("カスタムイベントの props", () => {
  it("レビュー・報告・新規投稿・追認のイベントがある", () => {
    const names = new Set(calls.flatMap((call) => call.names));
    for (const required of [
      "review_submit",
      "report_submit",
      "add_toilet_submit",
      "add_toilet_confirm",
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  it("各イベントの props キーにコメント・IP・名前・メールなどの個人情報がない", () => {
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      for (const key of call.keys) {
        expect(
          PII_KEYS.has(key.toLowerCase()),
          `${call.file} ${call.names.join("/")} の props に ${key} がある`,
        ).toBe(false);
      }
      for (const forbidden of PII_KEYS) {
        const used = new RegExp(`\\b${forbidden}\\b`, "i").test(call.propsSource);
        expect(used, `${call.file} ${call.names.join("/")} が ${forbidden} を参照している`).toBe(
          false,
        );
      }
    }
  });

  it("レビューと報告の props は場所 ID と評価だけ", () => {
    const allowed = new Set(["toiletId", "rating", "accessLevel"]);
    const reviewCalls = calls.filter((call) =>
      call.names.some((name) => name === "review_submit" || name === "report_submit"),
    );
    expect(reviewCalls.length).toBeGreaterThan(0);
    for (const call of reviewCalls) {
      expect(call.keys.length).toBeGreaterThan(0);
      for (const key of call.keys) expect(allowed.has(key)).toBe(true);
    }
  });

  it("新規投稿と追認は成功 outcome の props だけを渡す", () => {
    const submissionCalls = calls.filter((call) =>
      call.names.some((name) => name === "add_toilet_submit" || name === "add_toilet_confirm"),
    );
    expect(submissionCalls.map((call) => call.names[0]).sort()).toEqual([
      "add_toilet_confirm",
      "add_toilet_submit",
    ]);
    for (const call of submissionCalls) {
      expect(call.propsSource).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
      const fileSrc = readFileSync(join(SRC, call.file), "utf8");
      expect(fileSrc).toContain(`const ${call.propsSource} = submissionEventProps(`);
      const props = submissionEventProps("pending");
      expect(Object.keys(props ?? {})).toEqual(["result"]);
    }
  });

  it("イベント名は analytics.ts の一覧コメントにある", () => {
    const catalog = readFileSync(fileURLToPath(new URL("./analytics.ts", import.meta.url)), "utf8");
    const names = new Set(calls.flatMap((call) => call.names));
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) {
      expect(catalog).toContain(name);
    }
  });
});

describe("submissionEventProps", () => {
  it("pending と promoted だけを返し、props は result のみ", () => {
    expect(submissionEventProps("pending")).toEqual({ result: "pending" });
    expect(submissionEventProps("promoted")).toEqual({ result: "promoted" });
    for (const outcome of ["pending", "promoted"] as const) {
      const props = submissionEventProps(outcome);
      expect(props).not.toBeNull();
      for (const key of Object.keys(props ?? {})) {
        expect(PII_KEYS.has(key.toLowerCase())).toBe(false);
      }
      expect(Object.keys(props ?? {})).toEqual(["result"]);
    }
  });

  it("dup・throttled・失敗ではイベント用 props を作らない", () => {
    expect(submissionEventProps("dup")).toBeNull();
    expect(submissionEventProps("throttled")).toBeNull();
    expect(submissionEventProps(undefined)).toBeNull();
    expect(submissionEventProps(null)).toBeNull();
  });
});
