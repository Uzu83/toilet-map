import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// H4 — POST /api/reviews の単体テスト
// カバー: 不正 JSON・必須フィールド欠落・非 UUID toiletId(#24)・rate limit(429)・成功(200)・500 の no-leak(#21)

// supabase クライアントをモック化
const fromMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseSecret: () => ({
    from: fromMock,
  }),
}));

import { POST } from "./route";

// 各テストで使う有効な UUID
const VALID_UUID = "11111111-2222-3333-4444-555555555555";

// POST リクエストを作るヘルパ。ip が違う IP バケットになるよう各テストで変える。
function makeReq(body: unknown, ip = "10.0.0.1", raw = false) {
  return new NextRequest("http://localhost/api/reviews", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": ip,
    },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const BASE_BODY = {
  toiletId: VALID_UUID,
  rating: 4,
  accessLevel: "open",
};

describe("POST /api/reviews — バリデーション", () => {
  it("不正 JSON → 400", async () => {
    const res = await POST(makeReq("{broken", "10.1.0.1", true));
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: string };
    expect(j.error).toMatch(/json/i);
  });

  it("toiletId 欠落 → 400", async () => {
    const res = await POST(makeReq({ rating: 4, accessLevel: "open" }, "10.1.0.2"));
    expect(res.status).toBe(400);
  });

  it("rating 欠落(notAToilet=false) → 400", async () => {
    const res = await POST(makeReq({ toiletId: VALID_UUID, accessLevel: "open" }, "10.1.0.3"));
    expect(res.status).toBe(400);
  });

  it("accessLevel が enum 外 → 400", async () => {
    const res = await POST(
      makeReq({ toiletId: VALID_UUID, rating: 3, accessLevel: "bogus" }, "10.1.0.4"),
    );
    expect(res.status).toBe(400);
  });

  it("#24 — 非 UUID toiletId → 400(rate-limit を消費しない)", async () => {
    const ip = "10.1.0.5";
    // 1回目: 非UUID → 400
    const res1 = await POST(makeReq({ ...BASE_BODY, toiletId: "not-a-uuid" }, ip));
    expect(res1.status).toBe(400);
    const j = (await res1.json()) as { error: string };
    expect(j.error).toMatch(/uuid/i);
    // 同 IP × 同 toiletId で直後に再送しても 429 にならない(rate-limit 未消費)
    // ※ non-UUID は rate limit キーにそもそも到達しない
    const res2 = await POST(makeReq({ ...BASE_BODY, toiletId: "not-a-uuid" }, ip));
    expect(res2.status).toBe(400); // 429 ではなく再び 400
  });
});

describe("POST /api/reviews — rate limit (429)", () => {
  it("同 IP × 同 toiletId で 2 回目 → 429", async () => {
    const ip = "10.2.0.1";
    // DB insert が成功する設定
    fromMock.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) });

    const res1 = await POST(makeReq(BASE_BODY, ip));
    expect(res1.status).toBe(200);

    // 2 回目: rate limit に弾かれる(DB は呼ばれない)
    const res2 = await POST(makeReq(BASE_BODY, ip));
    expect(res2.status).toBe(429);
    expect(res2.headers.get("retry-after")).not.toBeNull();
  });
});

describe("POST /api/reviews — 成功 (200)", () => {
  it("正常リクエスト → 200 ok:true", async () => {
    fromMock.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) });
    const res = await POST(makeReq(BASE_BODY, "10.3.0.1"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
  });
});

describe("POST /api/reviews — 500 no-leak (#21)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DB エラー → 500 だが error.message は返さない", async () => {
    const sensitiveMsg = "relation \"reviews\" does not exist";
    fromMock.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: sensitiveMsg } }),
    });
    const res = await POST(makeReq({ ...BASE_BODY, toiletId: "22222222-3333-4444-5555-666666666666" }, "10.4.0.1"));
    expect(res.status).toBe(500);
    const j = (await res.json()) as { error: string };
    // ジェネリックメッセージのみ返す(生の DB エラーを含まない)
    expect(j.error).toBe("internal error");
    expect(j.error).not.toContain(sensitiveMsg);
  });

  it("予期しない例外(throw) → 500 で例外テキストを返さない", async () => {
    const secretDetail = "secret_stack_trace_detail";
    fromMock.mockReturnValue({
      insert: vi.fn().mockRejectedValue(new Error(secretDetail)),
    });
    const res = await POST(makeReq({ ...BASE_BODY, toiletId: "33333333-4444-5555-6666-777777777777" }, "10.4.0.2"));
    expect(res.status).toBe(500);
    const j = (await res.json()) as { error: string };
    expect(j.error).toBe("internal error");
    expect(j.error).not.toContain(secretDetail);
  });
});
