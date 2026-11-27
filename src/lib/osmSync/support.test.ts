import { describe, expect, it } from "vitest";
import { overpassRemarkError } from "@/lib/osm";
import { backoffDelayMs, isOverpassTimeout } from "@/lib/osmSync/backoff";
import { cronAuthorized } from "@/lib/osmSync/auth";
import { sanitizeSyncError } from "@/lib/osmSync/sanitize";

describe("cronAuthorized", () => {
  const secret = "cron-test-value";

  it("秘密が未設定・空なら拒否する", () => {
    expect(cronAuthorized(`Bearer ${secret}`, undefined)).toBe(false);
    expect(cronAuthorized(`Bearer ${secret}`, "")).toBe(false);
  });

  it("Bearer が一致するときだけ許可する", () => {
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(cronAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(cronAuthorized("Bearer wrong-value!", secret)).toBe(false);
    expect(cronAuthorized(null, secret)).toBe(false);
    expect(cronAuthorized(secret, secret)).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  it("初回は待たず、その後は倍々で頭打ちする", () => {
    expect(backoffDelayMs(0)).toBe(0);
    expect(backoffDelayMs(1)).toBe(500);
    expect(backoffDelayMs(2)).toBe(1000);
    expect(backoffDelayMs(3)).toBe(2000);
    expect(backoffDelayMs(20)).toBe(8000);
  });
});

describe("isOverpassTimeout", () => {
  it("時間切れと 504 は分割対象、429 は対象外", () => {
    expect(isOverpassTimeout("Overpass API 全ミラー失敗: https://example.test -> timeout")).toBe(true);
    expect(isOverpassTimeout("upstream 504")).toBe(true);
    expect(isOverpassTimeout("The operation was aborted")).toBe(true);
    expect(isOverpassTimeout("429 Too Many Requests")).toBe(false);
  });
});

describe("overpassRemarkError", () => {
  it("HTTP 200 の時間切れ remark は失敗にする", () => {
    expect(overpassRemarkError("runtime error: Query timed out.")).toMatch(/timed out/);
    expect(overpassRemarkError(undefined)).toBeNull();
    expect(overpassRemarkError("ok")).toBeNull();
  });
});

describe("sanitizeSyncError", () => {
  it("秘密の形をした文字列を残さない", () => {
    const token = ["sb", "secret", "examplevalue"].join("_");
    const header = ["Bearer", "supersecretvalue"].join(" ");
    const text = sanitizeSyncError(
      new Error(`failed ${header} key=${token} CRON_SECRET=another-value postgres://user:pass@db.example/app`),
    );
    expect(text).not.toContain("examplevalue");
    expect(text).not.toContain("supersecretvalue");
    expect(text).not.toContain("another-value");
    expect(text).not.toContain("user:pass");
    expect(text).toContain("[redacted]");
  });

  it("500 文字を超える文は切る", () => {
    expect(sanitizeSyncError("x".repeat(800)).length).toBeLessThanOrEqual(500);
  });
});
