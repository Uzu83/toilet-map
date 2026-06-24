// テスト: requireAdminRead / requireAdminMutation のガードロジック。
//
// 検証内容:
//   READ: 認証済み → ok。未認証 → 401。オリジン関係なく通る(CSRF チェックなし)。
//   MUTATION: 401(未認証) → 403(別オリジン) → 400(不正 UUID) → ok(全て通過)の順序。
//     この「401 → 403 → 400」の順序が security invariant(session を先に確認することで
//     CSRF エラーの情報を未認証者に漏らさない、UUID エラーを未認証者に漏らさない)。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAdminSessionMock, resetAdminSession } from "./helpers";

// adminSession をモック(getAdminSessionMock で制御)。
vi.mock("@/lib/adminSession", () => ({
  getAdminSession: () => getAdminSessionMock(),
}));

// テスト対象を mock 後に import(vitest のホイスティング)。
import { requireAdminRead, requireAdminMutation } from "@/lib/adminHttp";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const INVALID_UUID = "not-a-uuid";

function makeReq(sameOrigin = true, method = "POST"): NextRequest {
  return new NextRequest("https://loomap.test/api/admin/test", {
    method,
    headers: {
      host: "loomap.test",
      origin: sameOrigin ? "https://loomap.test" : "https://evil.test",
    },
  });
}

beforeEach(() => {
  resetAdminSession();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────
// requireAdminRead
// ────────────────────────────────────────────────────────────────────
describe("requireAdminRead", () => {
  it("認証済み + 同一オリジン → ok (CSRF チェックなし)", async () => {
    const result = await requireAdminRead();
    expect(result.ok).toBe(true);
  });

  it("認証済み + 別オリジン → ok (READ は CSRF を課さない)", async () => {
    // READ ガードはオリジンを見ない。CSRF は変更系のみ(設計書の明示ルール)。
    // このテストは「別オリジンで GET しても通る」ことを意図的に確認する。
    const result = await requireAdminRead();
    expect(result.ok).toBe(true);
    // requireAdminRead は request を受け取らない = CSRF チェックが構造的に存在しない。
  });

  it("未認証 → ok:false + 401", async () => {
    getAdminSessionMock.mockReturnValue(null);
    const result = await requireAdminRead();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(401);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// requireAdminMutation — 順序検証が security invariant
// ────────────────────────────────────────────────────────────────────
describe("requireAdminMutation — guard check order (401 → 403 → 400)", () => {
  it("未認証 + 別オリジン + 不正UUID → 401(session が最初の壁)", async () => {
    // 未認証の攻撃者は 403 も 400 も見えない。session チェックが先。
    getAdminSessionMock.mockReturnValue(null);
    const result = await requireAdminMutation(makeReq(false), INVALID_UUID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(401);
    }
  });

  it("認証済み + 別オリジン + 不正UUID → 403(CSRF が 2 番目の壁)", async () => {
    // session は通ったが CSRF で弾かれる。UUID エラーは露出しない。
    const result = await requireAdminMutation(makeReq(false), INVALID_UUID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(403);
    }
  });

  it("認証済み + 同一オリジン + 不正UUID → 400(UUID が 3 番目の壁)", async () => {
    const result = await requireAdminMutation(makeReq(true), INVALID_UUID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(400);
    }
  });

  it("認証済み + 同一オリジン + 有効UUID → ok + id が返る", async () => {
    const result = await requireAdminMutation(makeReq(true), VALID_UUID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBe(VALID_UUID);
    }
  });

  it("rawId なし(analyze パターン) → UUID ステップをスキップして ok", async () => {
    // rawId を渡さない = UUID 検証なし。body の review_id は呼び出し元が別途検証する。
    const result = await requireAdminMutation(makeReq(true));
    expect(result.ok).toBe(true);
    if (result.ok) {
      // id は undefined(rawId を渡さなかったので)。
      expect(result.id).toBeUndefined();
    }
  });

  it("rawId なし + 未認証 → 401(UUID なしでも session チェックは動く)", async () => {
    getAdminSessionMock.mockReturnValue(null);
    const result = await requireAdminMutation(makeReq(true));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(401);
    }
  });

  it("rawId なし + 認証済み + 別オリジン → 403(UUID なしでも CSRF チェックは動く)", async () => {
    const result = await requireAdminMutation(makeReq(false));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(403);
    }
  });
});
