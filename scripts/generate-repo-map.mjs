#!/usr/bin/env node
// ============================================================================
// generate-repo-map.mjs — REPO_MAP.md の自動セクションを再生成する
// （/dev-secure scope:docs が scripts/ に配置。zero-dep / Node 18+）
//
// 設計上の最重要制約:
//   REPO_MAP.md には「自動生成セクション」と「手書きセクション」が同居する。
//   このスクリプトは <!-- repo-map:auto:begin --> 〜 <!-- repo-map:auto:end -->
//   の**間だけ**を書き換える。手書きセクション（Change hotspots /
//   Security-sensitive 等）は人間と AI が事故の記憶を蓄積する場所であり、
//   再生成で消えたら再発防止装置が失われる。全文上書きに書き換えないこと。
//
// WHY zero-dep: 依存を増やすと lock 変更 = Codex 合意ゲート対象になり、
//   「ドキュメント再生成」という軽い操作の摩擦が不釣り合いに大きくなるため。
// ============================================================================
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const REPO_MAP = "REPO_MAP.md";
const BEGIN = "<!-- repo-map:auto:begin -->";
const END = "<!-- repo-map:auto:end -->";

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

// REPO_MAP.md を「存在チェックしてから書く」のではなく直接読む。
// WHY（CodeQL js/file-system-race[high] 対策・PR #20 で検出）:
//   旧実装は existsSync(REPO_MAP) で存在確認 → 後段 line で writeFileSync という
//   check-then-use（TOCTOU）だった。チェックと書き込みの間にファイルが差し替わり
//   うるため CodeQL が high で指摘。存在確認は「読めたか」で兼ね、ENOENT のときだけ
//   「テンプレ未配置」の friendly メッセージにフォールバックする。それ以外の error
//   （権限・I/O 異常）は握りつぶさず re-throw し、障害を隠さない。
//   読み込んだ src は後段のマーカー差し替えでそのまま再利用する（二重 read しない）。
let src;
try {
  src = readFileSync(REPO_MAP, "utf8");
} catch (err) {
  if (err.code === "ENOENT") {
    console.error(
      `${REPO_MAP} がありません。先に /dev-secure scope:docs でテンプレートを配置してください。`
    );
    process.exit(1);
  }
  throw err;
}

// --- 収集 -------------------------------------------------------------------
const files = sh("git ls-files").split("\n").filter(Boolean);

// トップレベル構成（ファイル数つき）。「どこに何があるか」の一次索引。
const topLevel = new Map();
for (const f of files) {
  const head = f.includes("/") ? f.split("/")[0] + "/" : f;
  topLevel.set(head, (topLevel.get(head) ?? 0) + 1);
}

// Next.js App Router のルート一覧 = このアプリの「公開表面」。
// page/route/layout だけ拾う理由: エントリポイントの増減こそ
// レビューで最初に見るべき差分だから（コンポーネント増減はノイズ）。
const routes = files.filter((f) =>
  /^(src\/)?app\/.*\/(page|route|layout)\.(t|j)sx?$/.test(f)
);

// package.json scripts = このリポジトリで「実行してよいコマンド」の一覧。
// package.json も existsSync を前置きせず直接読む（file-system-race 回避の一貫化）。
let scripts = {};
try {
  scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
} catch (err) {
  // package.json 不在（ENOENT）は許容し scripts 空で続行。JSON 破損等はそのまま投げる。
  if (err.code !== "ENOENT") throw err;
}

// --- 自動セクションの組み立て -------------------------------------------------
const lines = [
  BEGIN,
  "<!-- このブロックは scripts/generate-repo-map.mjs が再生成する。手で編集しない -->",
  "",
  `_最終生成: ${new Date().toISOString()} / commit: ${sh("git rev-parse --short HEAD")}_`,
  "",
  "### トップレベル構成",
  "",
  "| Path | Files |",
  "|---|---:|",
  ...[...topLevel.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `| \`${k}\` | ${v} |`),
  "",
  "### ルート（公開表面）",
  "",
  ...(routes.length
    ? routes.sort().map((r) => `- \`${r}\``)
    : ["- （App Router のルートなし）"]),
  "",
  "### コマンド",
  "",
  ...Object.entries(scripts).map(([k, v]) => `- \`pnpm ${k}\` — \`${v}\``),
  END,
];

// --- マーカー間のみ差し替え ----------------------------------------------------
// src は冒頭で読み込み済み（TOCTOU 回避のため存在チェックと読み込みを一本化した）。
const beginIdx = src.indexOf(BEGIN);
const endIdx = src.indexOf(END);
if (beginIdx === -1 || endIdx === -1) {
  console.error(
    `${REPO_MAP} に ${BEGIN} / ${END} マーカーがありません。手書き内容の保護ができないため中止します。`
  );
  process.exit(1);
}
const next =
  src.slice(0, beginIdx) + lines.join("\n") + src.slice(endIdx + END.length);
writeFileSync(REPO_MAP, next);

// メタデータ（監査・鮮度KPI用）。「REPO_MAP が変更後24h以内に更新されたか」を
// 機械判定するための一次データになる。
mkdirSync("docs/metadata", { recursive: true });
writeFileSync(
  "docs/metadata/repo-map.json",
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      git_head: sh("git rev-parse HEAD"),
      generated_by: "scripts/generate-repo-map.mjs",
      file_count: files.length,
      route_count: routes.length,
    },
    null,
    2
  ) + "\n"
);

console.log(`${REPO_MAP} の自動セクションを再生成しました（手書きセクションは保持）。`);
