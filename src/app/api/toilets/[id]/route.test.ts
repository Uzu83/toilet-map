// テスト: GET /api/toilets/[id]
//
// 検証内容:
//   ①不正 UUID → 400(RPC を呼ばない)
//   ②RPC エラー → 500(生メッセージを返さない)
//   ③row なし → 404
//   ④成功 → 200 + toToilet() で正規化された Toilet 形状
//
// WHY toToilet 正規化テストが重要か(PR2 #13):
//   以前は RPC の raw 行をそのまま { toilet: row } で返していた。toToilet 正規化を通すことで
//   型が Toilet shape に統一される。このテストがそれを「以後も維持する」ロック(regression guard)になる。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Supabase publishable client モック
type RpcResult = { data: unknown; error: { message: string } | null };
let rpcResult: RpcResult;

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabasePublishable: () => ({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rpc(_fn: string, _args: unknown) {
      return Promise.resolve(rpcResult);
    },
  }),
}));

import { GET } from "./route";

// RPC が返す raw 行(DB 由来 / toToilet 前の shape)。
const RAW_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "テストトイレ",
  lat: 33.59,
  lng: 130.40,
  source: "osm",
  has_washlet: true,
  has_diaper_table: null,
  is_universal: false,
  review_count: 3,
  avg_rating: "4.2", // DB は数値文字列を返すことがある → toToilet が Number() で正規化する
  dominant_access: "open",
  inferred_access: null,
  opening_hours: "24/7",
  not_a_toilet_count: 0,
};

const VALID_ID = "11111111-1111-1111-1111-111111111111";

function makeReq(id: string): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(`https://loomap.test/api/toilets/${id}`),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  rpcResult = { data: [RAW_ROW], error: null };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/toilets/[id]", () => {
  it("不正 UUID → 400(RPC を呼ばない)", async () => {
    const [req, ctx] = makeReq("not-a-uuid");
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  it("RPC エラー → 500(生 DB 文言は返さない)", async () => {
    rpcResult = { data: null, error: { message: "raw postgres error: column x" } };
    const [req, ctx] = makeReq(VALID_ID);
    const res = await GET(req, ctx);
    expect(res.status).toBe(500);
    const j = (await res.json()) as { error: string };
    // 生 DB 文言は返さない(PR2 #21 error-leak 対応)。
    expect(j.error).toBe("internal error");
    expect(j.error).not.toContain("column");
  });

  it("row なし(空配列)→ 404", async () => {
    rpcResult = { data: [], error: null };
    const [req, ctx] = makeReq(VALID_ID);
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("row なし(null)→ 404", async () => {
    rpcResult = { data: null, error: null };
    const [req, ctx] = makeReq(VALID_ID);
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("成功 → 200 + toToilet() 正規化済み Toilet shape", async () => {
    const [req, ctx] = makeReq(VALID_ID);
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);

    const j = (await res.json()) as { toilet: Record<string, unknown> };
    const t = j.toilet;

    // 必須フィールドの存在確認。
    expect(t.id).toBe(VALID_ID);
    expect(t.name).toBe("テストトイレ");

    // toToilet() による型正規化を確認。
    // avg_rating: DB の "4.2"(文字列)が Number に変換される。
    expect(typeof t.avg_rating).toBe("number");
    expect(t.avg_rating).toBeCloseTo(4.2);

    // is_universal: false(DB 由来)が boolean のまま。
    expect(t.is_universal).toBe(false);

    // has_diaper_table: null が null のまま。
    expect(t.has_diaper_table).toBeNull();

    // review_count, not_a_toilet_count は number。
    expect(typeof t.review_count).toBe("number");
    expect(typeof t.not_a_toilet_count).toBe("number");

    // source は "osm" | "user" | "inferred" の一つ。
    expect(["osm", "user", "inferred"]).toContain(t.source);
  });

  it("data が配列でなく単一オブジェクトの場合も 200 で正常処理", async () => {
    // RPC が配列でなく直接オブジェクトを返すケース(supabase-js の挙動差異対応)。
    rpcResult = { data: RAW_ROW, error: null };
    const [req, ctx] = makeReq(VALID_ID);
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
  });
});
