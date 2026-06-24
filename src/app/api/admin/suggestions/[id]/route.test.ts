import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAdminSessionMock } from "../../__tests__/helpers";

// ───────────────────────────────────────────────────────────────────
// テストの射程(app 層のみ)
// ───────────────────────────────────────────────────────────────────
// POST /api/admin/suggestions/[id] は approve/reject の薄いラッパ。検証できるのは:
//   ①認証 / CSRF / id バリデーション / action バリデーション
//   ②approve が ai_apply_suggestion RPC を「manual + actor='ai'」で呼ぶ(toilets を直 update しない)
//   ③reject が ai_suggestions の status UPDATE のみ(RPC を呼ばない・toilets を触らない)
//   ④RPC エラーメッセージ → HTTP 写像(409/404 等)
// ⚠️ plpgsql 本体(FOR UPDATE / 単一 tx / 409 不変条件 / 監査の同一トランザクション性)は live smoke 専管。
//   既存 toilets/[id]/route.test.ts の流儀(adminSession / supabase secret / origin)に倣う。

// WHY インラインファクトリ: vitest は vi.mock() をホイストするため外部 factory 関数は初期化前参照エラーになる。
vi.mock("@/lib/adminSession", () => ({
  getAdminSession: () => getAdminSessionMock(),
}));

// ── Supabase secret client モック ───────────────────────────────────
// rpc(approve)と from().update()(reject)の両方を捕捉する。
type RpcCall = { fn: string; args: Record<string, unknown> };
type UpdateCall = { table: string; values: Record<string, unknown>; eqs: Array<[string, unknown]> };

let rpcCalls: RpcCall[];
let rpcResult: { data: unknown; error: { message: string } | null };
let updateCalls: UpdateCall[];
let updateResult: { data: Array<{ id: string }> | null; error: { code?: string; message: string } | null };

function makeSupabase() {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
    from(table: string) {
      // reject 経路: .update(values).eq("id", id).eq("status","pending").select("id")
      return {
        update(values: Record<string, unknown>) {
          const call: UpdateCall = { table, values, eqs: [] };
          updateCalls.push(call);
          const chain = {
            eq(col: string, val: unknown) {
              call.eqs.push([col, val]);
              return chain;
            },
            select() {
              return Promise.resolve(updateResult);
            },
          };
          return chain;
        },
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseSecret: () => makeSupabase(),
}));

import { POST } from "./route";

const SUGG_ID = "44444444-4444-4444-4444-444444444444";

function req(body: unknown, sameOrigin = true) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  headers.host = "loomap.test";
  headers.origin = sameOrigin ? "https://loomap.test" : "https://evil.test";
  return new NextRequest(`https://loomap.test/api/admin/suggestions/${SUGG_ID}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: SUGG_ID }) };
const ctxBadId = { params: Promise.resolve({ id: "not-a-uuid" }) };

beforeEach(() => {
  rpcCalls = [];
  rpcResult = {
    data: { applied: true, status: "approved", edit_id: "edit-1", changed_fields: ["has_washlet"] },
    error: null,
  };
  updateCalls = [];
  updateResult = { data: [{ id: SUGG_ID }], error: null };
  getAdminSessionMock.mockReturnValue({ exp: 9_999_999_999, role: "admin" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/suggestions/[id] — guard", () => {
  it("未認証 → 401(RPC を呼ばない)", async () => {
    getAdminSessionMock.mockReturnValue(null);
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("CSRF(別オリジン)→ 403", async () => {
    const res = await POST(req({ action: "approve" }, false), ctx);
    expect(res.status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it("不正な id → 400", async () => {
    const res = await POST(req({ action: "approve" }), ctxBadId);
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it("action が approve/reject 以外 → 400", async () => {
    const res = await POST(req({ action: "delete" }), ctx);
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("POST /api/admin/suggestions/[id] — approve", () => {
  it("ai_apply_suggestion RPC を manual + actor='ai' で呼ぶ(toilets 直 update なし)", async () => {
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; applied: boolean; status: string };
    expect(j.applied).toBe(true);
    expect(j.status).toBe("approved");

    // RPC は 1 回・正しい引数。
    expect(rpcCalls).toHaveLength(1);
    const call = rpcCalls[0]!;
    expect(call.fn).toBe("ai_apply_suggestion");
    expect(call.args.p_suggestion_id).toBe(SUGG_ID);
    expect(call.args.p_actor).toBe("ai"); // 反映値の出所(reviewed_by は RPC が p_mode から決める)
    expect(call.args.p_mode).toBe("manual");
    expect(call.args.p_threshold).toBeNull();

    // approve では toilets を直接 update しない(RPC 経由のみ)= update 呼び出しゼロ。
    expect(updateCalls).toHaveLength(0);
  });

  it("no-op(applied:false)→ 200・changed:[]", async () => {
    rpcResult = {
      data: { applied: false, status: "no_op", edit_id: null, changed_fields: [] },
      error: null,
    };
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { applied: boolean; status: string; changed: string[] };
    expect(j.applied).toBe(false);
    expect(j.status).toBe("no_op");
    expect(j.changed).toEqual([]);
  });

  it("RPC 'suggestion not pending' → 409(二重反映防止)", async () => {
    rpcResult = { data: null, error: { message: "admin_rpc: suggestion not pending" } };
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(409);
  });

  it("RPC 'suggestion not found' → 404", async () => {
    rpcResult = { data: null, error: { message: "admin_rpc: suggestion not found" } };
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(404);
  });

  it("RPC 想定外エラー → 500(生 DB 文言を返さない)", async () => {
    rpcResult = { data: null, error: { message: "raw postgres: column x ambiguous" } };
    const res = await POST(req({ action: "approve" }), ctx);
    expect(res.status).toBe(500);
    const j = (await res.json()) as { error: string };
    expect(j.error).toBe("internal error");
  });
});

describe("POST /api/admin/suggestions/[id] — reject", () => {
  it("status UPDATE のみ(RPC を呼ばない)・pending precondition で絞る", async () => {
    const res = await POST(req({ action: "reject", reason: "誤検出" }), ctx);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; status: string };
    expect(j.status).toBe("rejected");

    // reject は RPC を呼ばない(toilets を触らないので原子性 RPC 不要)。
    expect(rpcCalls).toHaveLength(0);

    // ai_suggestions を 1 回 update。status='rejected' + reviewed_by='admin' + reason。
    expect(updateCalls).toHaveLength(1);
    const call = updateCalls[0]!;
    expect(call.table).toBe("ai_suggestions");
    expect(call.values).toMatchObject({
      status: "rejected",
      reviewed_by: "admin",
      rejected_reason: "誤検出",
    });
    // precondition: id 一致 + status='pending'(二重処理防止)。
    expect(call.eqs).toContainEqual(["id", SUGG_ID]);
    expect(call.eqs).toContainEqual(["status", "pending"]);
  });

  it("0 行更新(既に終端)→ 409", async () => {
    updateResult = { data: [], error: null };
    const res = await POST(req({ action: "reject" }), ctx);
    expect(res.status).toBe(409);
    expect(rpcCalls).toHaveLength(0);
  });

  it("UPDATE が DB エラー → 500", async () => {
    updateResult = { data: null, error: { code: "XX000", message: "boom" } };
    const res = await POST(req({ action: "reject" }), ctx);
    expect(res.status).toBe(500);
  });
});
