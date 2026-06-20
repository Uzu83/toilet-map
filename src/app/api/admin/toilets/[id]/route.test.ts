import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ───────────────────────────────────────────────────────────────────
// テストの射程(重要)
// ───────────────────────────────────────────────────────────────────
// このルートは 012 の plpgsql RPC(admin_apply_edit / admin_undo_edit)を「呼ぶだけ」の薄いラッパに
// リファクタした。よってここで検証できるのは:
//   ①認証 / CSRF / id・editId バリデーション ②allowlist(validateEdit)による 400 拒否
//   ③RPC に渡す引数(p_editor='admin', p_patch, p_toilet_id, p_edit_id)
//   ④RPC 戻り値 / RPC エラーメッセージ → HTTP ステータスの写像(200/no-op/404/409/500)
// ⚠️ plpgsql 本体ロジック(FOR UPDATE の行ロック・列衝突 #variable_conflict・409 不変条件・
//    監査の同一トランザクション性)は vitest のモックでは一切検証できない。
//    これらは「本番/staging の live smoke」でのみ担保できる(プロジェクト既知方針 = MEMORY: DB RPC live smoke。
//    submit_toilet の plpgsql 列衝突をモックが見逃し本番 500 を出した教訓と同じ)。

// 認証 cookie 再検証(adminSession)をモックして、テストごとに認証可否を切り替える。
const getAdminSessionMock = vi.fn();
vi.mock("@/lib/adminSession", () => ({
  getAdminSession: () => getAdminSessionMock(),
}));

// Supabase の rpc() をモックする。呼ばれた関数名/引数を捕捉し、テストごとに戻り値(data/error)を差し替える。
type RpcCall = { fn: string; args: Record<string, unknown> };
type RpcResult = { data: unknown; error: { message: string } | null };

let rpcCalls: RpcCall[];
// 関数名 → 返す結果。未設定なら applied:true 相当のダミーを返す。
let rpcResults: Record<string, RpcResult>;

function makeSupabase() {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      const r = rpcResults[fn];
      if (r) return Promise.resolve(r);
      // デフォルト: 何も設定しなければ「成功(applied)」を返す。
      return Promise.resolve({
        data: { applied: true, edit_id: "edit-x", changed_fields: ["name"] },
        error: null,
      } satisfies RpcResult);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseSecret: () => makeSupabase(),
}));

import { PATCH, DELETE } from "./route";

const TOILET_ID = "11111111-1111-1111-1111-111111111111";
const EDIT_ID = "22222222-2222-2222-2222-222222222222";

function patchReq(body: unknown, sameOrigin = true) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  headers.host = "loomap.test";
  headers.origin = sameOrigin ? "https://loomap.test" : "https://evil.test";
  return new NextRequest(`https://loomap.test/api/admin/toilets/${TOILET_ID}`, {
    method: "PATCH",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deleteReq(sameOrigin = true, editId: string | null = EDIT_ID) {
  const headers: Record<string, string> = {
    host: "loomap.test",
    origin: sameOrigin ? "https://loomap.test" : "https://evil.test",
  };
  const qs = editId ? `?editId=${editId}` : "";
  return new NextRequest(`https://loomap.test/api/admin/toilets/${TOILET_ID}${qs}`, {
    method: "DELETE",
    headers,
  });
}

const ctx = { params: Promise.resolve({ id: TOILET_ID }) };
const ctxBadId = { params: Promise.resolve({ id: "not-a-uuid" }) };

beforeEach(() => {
  rpcCalls = [];
  rpcResults = {};
  getAdminSessionMock.mockReturnValue({ exp: 9_999_999_999, role: "admin" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/admin/toilets/[id]", () => {
  it("未認証 → 401(RPC を呼ばない)", async () => {
    getAdminSessionMock.mockReturnValue(null);
    const res = await PATCH(patchReq({ name: "新" }), ctx);
    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  it("CSRF(別オリジン) → 403(RPC を呼ばない)", async () => {
    const res = await PATCH(patchReq({ name: "新" }, false), ctx);
    expect(res.status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it("不正な id → 400", async () => {
    const res = await PATCH(patchReq({ name: "新" }), ctxBadId);
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it("allowlist 外(source)→ 400(validateEdit が拒否、RPC を呼ばない)", async () => {
    const res = await PATCH(patchReq({ source: "user" }), ctx);
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it("正常編集 → 200・admin_apply_edit を p_editor='admin' + allowlist パッチで呼ぶ", async () => {
    rpcResults.admin_apply_edit = {
      data: { applied: true, edit_id: "edit-1", changed_fields: ["has_washlet", "name"] },
      error: null,
    };
    const res = await PATCH(patchReq({ name: "新名称", has_washlet: true }), ctx);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { changed: string[] };
    expect(j.changed.sort()).toEqual(["has_washlet", "name"]);

    // RPC は 1 回・正しい引数で呼ばれる。
    expect(rpcCalls).toHaveLength(1);
    const call = rpcCalls[0]!;
    expect(call.fn).toBe("admin_apply_edit");
    expect(call.args.p_toilet_id).toBe(TOILET_ID);
    expect(call.args.p_editor).toBe("admin");
    // p_patch は validateEdit を通った allowlist のみ。source は構造的に含まれない。
    expect(call.args.p_patch).toMatchObject({ name: "新名称", has_washlet: true });
    expect(call.args.p_patch).not.toHaveProperty("source");
  });

  it("no-op(applied:false)→ 200・changed:[]", async () => {
    rpcResults.admin_apply_edit = {
      data: { applied: false, edit_id: null, changed_fields: [] },
      error: null,
    };
    const res = await PATCH(patchReq({ name: "旧名称" }), ctx);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { changed: string[] };
    expect(j.changed).toEqual([]);
  });

  it("RPC が 'toilet not found' → 404", async () => {
    rpcResults.admin_apply_edit = {
      data: null,
      error: { message: "admin_rpc: toilet not found" },
    };
    const res = await PATCH(patchReq({ name: "新" }), ctx);
    expect(res.status).toBe(404);
  });

  it("RPC が想定外エラー → 500(生 DB 文言は返さない)", async () => {
    rpcResults.admin_apply_edit = {
      data: null,
      error: { message: "some raw postgres error: column x" },
    };
    const res = await PATCH(patchReq({ name: "新" }), ctx);
    expect(res.status).toBe(500);
    const j = (await res.json()) as { error: string };
    expect(j.error).toBe("internal error"); // 生メッセージを露出しない
  });
});

describe("DELETE /api/admin/toilets/[id] — 取消", () => {
  it("未認証 → 401(RPC を呼ばない)", async () => {
    getAdminSessionMock.mockReturnValue(null);
    const res = await DELETE(deleteReq(), ctx);
    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  it("CSRF(別オリジン) → 403(RPC を呼ばない)", async () => {
    const res = await DELETE(deleteReq(false), ctx);
    expect(res.status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it("editId 欠落 → 400(RPC を呼ばない)", async () => {
    const res = await DELETE(deleteReq(true, null), ctx);
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it("正常取消 → 200・admin_undo_edit を p_toilet_id/p_edit_id で呼ぶ", async () => {
    rpcResults.admin_undo_edit = {
      data: { restored: ["name"], undo_edit_id: "undo-1" },
      error: null,
    };
    const res = await DELETE(deleteReq(), ctx);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { restored: string[] };
    expect(j.restored).toEqual(["name"]);

    expect(rpcCalls).toHaveLength(1);
    const call = rpcCalls[0]!;
    expect(call.fn).toBe("admin_undo_edit");
    expect(call.args.p_toilet_id).toBe(TOILET_ID);
    expect(call.args.p_edit_id).toBe(EDIT_ID);
  });

  it("RPC が 'no edit to undo' → 404", async () => {
    rpcResults.admin_undo_edit = {
      data: null,
      error: { message: "admin_rpc: no edit to undo" },
    };
    const res = await DELETE(deleteReq(), ctx);
    expect(res.status).toBe(404);
  });

  it("RPC が 'edit is not latest' → 409(後続編集あり)", async () => {
    rpcResults.admin_undo_edit = {
      data: null,
      error: { message: "admin_rpc: edit is not latest" },
    };
    const res = await DELETE(deleteReq(), ctx);
    expect(res.status).toBe(409);
  });

  it("RPC が 'current value drifted' → 409(現在値が after と不一致)", async () => {
    rpcResults.admin_undo_edit = {
      data: null,
      error: { message: "admin_rpc: current value drifted" },
    };
    const res = await DELETE(deleteReq(), ctx);
    expect(res.status).toBe(409);
  });
});
