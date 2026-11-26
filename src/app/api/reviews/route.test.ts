import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// H4 — POST /api/reviews の単体テスト
// カバー: 不正 JSON・必須フィールド欠落・非 UUID toiletId(#24)・rate limit(429)・成功(200)・500 の no-leak(#21)
//         任意設備は RPC に載るが必須ではない。名前/メール/電話は渡さない。

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseSecret: () => ({
    rpc: rpcMock,
  }),
}));

import { POST } from "./route";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  rpcMock.mockReset();
});

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

function rpcArgs() {
  return rpcMock.mock.calls.at(-1)?.[1] as Record<string, unknown>;
}

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
    const res1 = await POST(makeReq({ ...BASE_BODY, toiletId: "not-a-uuid" }, ip));
    expect(res1.status).toBe(400);
    const j = (await res1.json()) as { error: string };
    expect(j.error).toMatch(/uuid/i);
    const res2 = await POST(makeReq({ ...BASE_BODY, toiletId: "not-a-uuid" }, ip));
    expect(res2.status).toBe(400);
  });

  it("設備の型が壊れていても 400 で、レート枠を消費しない", async () => {
    const ip = "10.1.0.6";
    const bad = await POST(makeReq({ ...BASE_BODY, hasPaper: "yes" }, ip));
    expect(bad.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue({ data: "review-1", error: null });
    const ok = await POST(makeReq(BASE_BODY, ip));
    expect(ok.status).toBe(200);
  });
});

describe("POST /api/reviews — rate limit (429)", () => {
  it("同 IP × 同 toiletId で 2 回目 → 429", async () => {
    const ip = "10.2.0.1";
    rpcMock.mockResolvedValue({ data: "review-1", error: null });

    const res1 = await POST(makeReq(BASE_BODY, ip));
    expect(res1.status).toBe(200);

    const res2 = await POST(makeReq(BASE_BODY, ip));
    expect(res2.status).toBe(429);
    expect(res2.headers.get("retry-after")).not.toBeNull();
  });

  it("設備付きでも同じ 1 時間 1 回の制限", async () => {
    const ip = "10.2.0.2";
    rpcMock.mockResolvedValue({ data: "review-2", error: null });
    const body = { ...BASE_BODY, hasPaper: true, openingHours: "24/7" };
    expect((await POST(makeReq(body, ip))).status).toBe(200);
    expect((await POST(makeReq(body, ip))).status).toBe(429);
  });
});

describe("POST /api/reviews — 成功 (200)", () => {
  it("正常リクエスト → 200 ok:true。未選択の設備は null", async () => {
    rpcMock.mockResolvedValue({ data: "review-1", error: null });
    const res = await POST(makeReq(BASE_BODY, "10.3.0.1"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      "insert_review_with_claims",
      expect.objectContaining({
        p_toilet_id: VALID_UUID,
        p_rating: 4,
        p_access: "open",
        p_has_paper: null,
        p_has_washlet: null,
        p_has_soap: null,
        p_has_diaper_table: null,
        p_opening_hours: null,
        p_not_a_toilet: false,
      }),
    );
    const args = rpcArgs();
    expect(args).not.toHaveProperty("email");
    expect(args).not.toHaveProperty("phone");
    expect(args).not.toHaveProperty("name");
    expect(args).not.toHaveProperty("p_email");
    expect(args).not.toHaveProperty("p_name");
    expect(args).not.toHaveProperty("p_phone");
  });

  it("任意設備を RPC に渡す。個人情報フィールドは引数にしない", async () => {
    rpcMock.mockResolvedValue({ data: "review-3", error: null });
    const res = await POST(
      makeReq(
        {
          ...BASE_BODY,
          hasPaper: true,
          hasWashlet: false,
          hasSoap: true,
          hasDiaperTable: false,
          openingHours: " 9:00-21:00 ",
          email: "a@example.com",
          phone: "09000000000",
          name: "山田",
        },
        "10.3.0.2",
      ),
    );
    expect(res.status).toBe(200);
    const args = rpcArgs();
    expect(args.p_has_paper).toBe(true);
    expect(args.p_has_washlet).toBe(false);
    expect(args.p_has_soap).toBe(true);
    expect(args.p_has_diaper_table).toBe(false);
    expect(args.p_opening_hours).toBe("9:00-21:00");
    expect(JSON.stringify(args)).not.toContain("a@example.com");
    expect(JSON.stringify(args)).not.toContain("09000000000");
    expect(JSON.stringify(args)).not.toContain("山田");
  });

  it("「ここトイレない」は設備を null にする", async () => {
    rpcMock.mockResolvedValue({ data: "review-4", error: null });
    const res = await POST(
      makeReq(
        {
          toiletId: VALID_UUID,
          notAToilet: true,
          hasPaper: true,
          openingHours: "24/7",
          comment: "無い",
        },
        "10.3.0.3",
      ),
    );
    expect(res.status).toBe(200);
    const args = rpcArgs();
    expect(args.p_not_a_toilet).toBe(true);
    expect(args.p_has_paper).toBeNull();
    expect(args.p_opening_hours).toBeNull();
  });
});

describe("POST /api/reviews — 500 no-leak (#21)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DB エラー → 500 だが error.message は返さない", async () => {
    const sensitiveMsg = "relation \"reviews\" does not exist";
    rpcMock.mockResolvedValue({ error: { message: sensitiveMsg } });
    const res = await POST(makeReq({ ...BASE_BODY, toiletId: "22222222-3333-4444-5555-666666666666" }, "10.4.0.1"));
    expect(res.status).toBe(500);
    const j = (await res.json()) as { error: string };
    expect(j.error).toBe("internal error");
    expect(j.error).not.toContain(sensitiveMsg);
  });

  it("予期しない例外(throw) → 500 で例外テキストを返さない", async () => {
    const secretDetail = "secret_stack_trace_detail";
    rpcMock.mockRejectedValue(new Error(secretDetail));
    const res = await POST(makeReq({ ...BASE_BODY, toiletId: "33333333-4444-5555-6666-777777777777" }, "10.4.0.2"));
    expect(res.status).toBe(500);
    const j = (await res.json()) as { error: string };
    expect(j.error).toBe("internal error");
    expect(j.error).not.toContain(secretDetail);
  });
});
