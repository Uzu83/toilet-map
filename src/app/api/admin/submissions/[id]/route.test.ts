import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAdminSessionMock } from "../../__tests__/helpers";

vi.mock("@/lib/adminSession", () => ({
  getAdminSession: () => getAdminSessionMock(),
}));

type RpcCall = { fn: string; args: Record<string, unknown> };
let rpcCalls: RpcCall[];
let rpcResult: { data: unknown; error: { message: string } | null };

function makeSupabase() {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
    from() {
      throw new Error("toilets must not be written from the route");
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseSecret: () => makeSupabase(),
}));

import { POST } from "./route";

const SUB_ID = "55555555-5555-4555-8555-555555555555";

function req(body: unknown, sameOrigin = true) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  headers.host = "loomap.test";
  headers.origin = sameOrigin ? "https://loomap.test" : "https://evil.test";
  return new NextRequest(`https://loomap.test/api/admin/submissions/${SUB_ID}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: SUB_ID }) };
const ctxBadId = { params: Promise.resolve({ id: "not-a-uuid" }) };

beforeEach(() => {
  rpcCalls = [];
  rpcResult = {
    data: { result: "approved", status: "approved", toilet_id: "toilet-1" },
    error: null,
  };
  getAdminSessionMock.mockReturnValue({ exp: 9_999_999_999, role: "admin" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/submissions/[id]", () => {
  it("未認証 → 401", async () => {
    getAdminSessionMock.mockReturnValue(null);
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  it("別オリジン → 403", async () => {
    const res = await POST(req({ action: "approve" }, false), ctx);
    expect(res.status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it("不正 id → 400", async () => {
    const res = await POST(req({ action: "approve" }), ctxBadId);
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it("action 不正 → 400", async () => {
    const res = await POST(req({ action: "delete" }), ctx);
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it("承認は admin_decide_submission だけを呼ぶ", async () => {
    const res = await POST(req({ action: "approve", reason: "現地確認" }), ctx);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { toiletId: string; result: string };
    expect(j.result).toBe("approved");
    expect(j.toiletId).toBe("toilet-1");
    expect(rpcCalls).toEqual([
      {
        fn: "admin_decide_submission",
        args: { p_submission_id: SUB_ID, p_action: "approve", p_reason: "現地確認" },
      },
    ]);
  });

  it("却下は rejected を渡し、toilets を route から書かない", async () => {
    rpcResult = { data: { result: "rejected", status: "rejected", toilet_id: null }, error: null };
    const res = await POST(req({ action: "reject" }), ctx);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { result: string; toiletId: string | null };
    expect(j.result).toBe("rejected");
    expect(j.toiletId).toBeNull();
    expect(rpcCalls[0]?.args.p_action).toBe("reject");
    expect(rpcCalls[0]?.fn).toBe("admin_decide_submission");
  });

  it("既に処理済み → 409", async () => {
    rpcResult = { data: null, error: { message: "admin_rpc: submission not pending" } };
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(409);
    const j = (await res.json()) as { error: string };
    expect(j.error).toBe("conflict: already processed");
  });

  it("30m 以内に既存トイレ → 409 で本番へは進まない", async () => {
    rpcResult = { data: null, error: { message: "admin_rpc: nearby toilet exists" } };
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(409);
    const j = (await res.json()) as { error: string };
    expect(j.error).toBe("conflict: nearby toilet exists");
    expect(j.error).not.toContain("admin_rpc");
  });

  it("不存在 → 404。生 DB 文言は返さない", async () => {
    rpcResult = { data: null, error: { message: "admin_rpc: submission not found" } };
    const res = await POST(req({ action: "reject" }), ctx);
    expect(res.status).toBe(404);
    const j = (await res.json()) as { error: string };
    expect(j.error).toBe("not found");
  });
});
