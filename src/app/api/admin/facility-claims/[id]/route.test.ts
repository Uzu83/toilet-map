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

const CLAIM_ID = "66666666-6666-4666-8666-666666666666";

function req(body: unknown, sameOrigin = true) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  headers.host = "loomap.test";
  headers.origin = sameOrigin ? "https://loomap.test" : "https://evil.test";
  return new NextRequest(`https://loomap.test/api/admin/facility-claims/${CLAIM_ID}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: CLAIM_ID }) };

beforeEach(() => {
  rpcCalls = [];
  rpcResult = {
    data: { applied: true, status: "approved", edit_id: "edit-1", changed_fields: ["has_paper"] },
    error: null,
  };
  getAdminSessionMock.mockReturnValue({ exp: 9_999_999_999, role: "admin" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/facility-claims/[id]", () => {
  it("未認証 → 401。RPC を呼ばない", async () => {
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

  it("承認は admin_decide_facility_claim だけ。toilets 直更新はしない", async () => {
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { applied: boolean; changed: string[] };
    expect(j.applied).toBe(true);
    expect(j.changed).toEqual(["has_paper"]);
    expect(rpcCalls).toEqual([
      {
        fn: "admin_decide_facility_claim",
        args: { p_claim_id: CLAIM_ID, p_action: "approve", p_reason: null },
      },
    ]);
  });

  it("却下は reject を渡す。反映フラグは false", async () => {
    rpcResult = {
      data: { applied: false, status: "rejected", edit_id: null, changed_fields: [] },
      error: null,
    };
    const res = await POST(req({ action: "reject", reason: "根拠が弱い" }), ctx);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { applied: boolean; status: string };
    expect(j.applied).toBe(false);
    expect(j.status).toBe("rejected");
    expect(rpcCalls[0]?.args).toEqual({
      p_claim_id: CLAIM_ID,
      p_action: "reject",
      p_reason: "根拠が弱い",
    });
  });

  it("同値の承認は applied false(no_op)でも 200", async () => {
    rpcResult = {
      data: { applied: false, status: "no_op", edit_id: null, changed_fields: [] },
      error: null,
    };
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { applied: boolean; status: string };
    expect(j.applied).toBe(false);
    expect(j.status).toBe("no_op");
  });

  it("処理済み → 409。内部メッセージは隠す", async () => {
    rpcResult = { data: null, error: { message: "admin_rpc: claim not pending" } };
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(409);
    const j = (await res.json()) as { error: string };
    expect(j.error).toBe("conflict: already processed");
    expect(j.error).not.toContain("admin_rpc");
  });

  it("不正な設備値 → 400", async () => {
    rpcResult = { data: null, error: { message: "admin_rpc: invalid facility value" } };
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(400);
  });
});
