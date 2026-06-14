import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// supabase クライアントをモック化(DB を叩かず rpc の戻り値を制御)。
const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseSecret: () => ({ rpc: rpcMock }),
  getServerSupabasePublishable: () => ({ rpc: rpcMock }),
}));

import { POST } from "./route";

// 座標は in-memory rate limit のキー衝突を避けるためテストごとに変える。
function postReq(body: unknown, ip = "10.0.0.1", raw = false) {
  return new NextRequest("http://localhost/api/submissions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const baseBody = { lat: 33.59, lng: 130.4, accessLevel: "open" as const };

describe("POST /api/submissions — バリデーション (TESTS-2.md §3)", () => {
  it("E12: 不正 JSON → 400 invalid json", async () => {
    const res = await POST(postReq("{not-json", "10.0.1.1", true));
    expect(res.status).toBe(400);
  });

  it("E8: lat/lng 欠落 → 400", async () => {
    const res = await POST(postReq({ accessLevel: "open" }, "10.0.2.1"));
    expect(res.status).toBe(400);
  });

  it("E9: access_level が enum 外 → 400", async () => {
    const res = await POST(
      postReq({ lat: 33.51, lng: 130.41, accessLevel: "bogus" }, "10.0.3.1"),
    );
    expect(res.status).toBe(400);
  });

  it("範囲外 lat → 400", async () => {
    const res = await POST(
      postReq({ lat: 999, lng: 130.41, accessLevel: "open" }, "10.0.4.1"),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/submissions — RPC 結果→HTTP マッピング", () => {
  it("N6: rpc=pending → 200", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ result: "pending", submission_id: "s1", confirm_count: 1 }],
      error: null,
    });
    const res = await POST(postReq({ ...baseBody, lat: 33.601 }, "10.1.1.1"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { result: string };
    expect(j.result).toBe("pending");
  });

  it("rpc=promoted → 201", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ result: "promoted", toilet_id: "t1", confirm_count: 3 }],
      error: null,
    });
    const res = await POST(postReq({ ...baseBody, lat: 33.602 }, "10.1.2.1"));
    expect(res.status).toBe(201);
  });

  it("E10: rpc=dup → 409", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ result: "dup", toilet_id: "t9" }],
      error: null,
    });
    const res = await POST(postReq({ ...baseBody, lat: 33.603 }, "10.1.3.1"));
    expect(res.status).toBe(409);
  });

  it("E5: rpc=throttled → 429", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ result: "throttled" }],
      error: null,
    });
    const res = await POST(postReq({ ...baseBody, lat: 33.604 }, "10.1.4.1"));
    expect(res.status).toBe(429);
  });

  it("rpc error → 500", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const res = await POST(postReq({ ...baseBody, lat: 33.605 }, "10.1.5.1"));
    expect(res.status).toBe(500);
  });
});
