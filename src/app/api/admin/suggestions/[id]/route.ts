import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/adminAuth";
import { noStore } from "@/lib/adminHttp";
import { getAdminSession } from "@/lib/adminSession";
import { getServerSupabaseSecret } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

// secret(SUPABASE_SECRET_KEY / ADMIN_SESSION_SECRET)を読むため Node ランタイム固定。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ───────────────────────────────────────────────────────────────────
// POST /api/admin/suggestions/[id] — AI 提案の approve(反映)/ reject(却下)(B1)
// ───────────────────────────────────────────────────────────────────
// body: { action: "approve" | "reject", reason?: string }
//
// ★ approve は必ず ai_apply_suggestion(p_mode='manual') RPC 経由(toilets を直接 .update() しない)。
//   理由 = PATCH route の guard コメントと同じ: toilets への書き込みは「監査 RPC 経由」でしか行わない。
//   ai_apply_suggestion は status 更新 + admin_apply_edit(toilets UPDATE + admin_edits INSERT)を単一 tx で実行し、
//   TOCTOU/部分適用/監査欠落を構造的に防ぐ(014 High②)。ここで .from("toilets").update() を書かないこと。
//
// ★ reject は ai_suggestions の status='rejected' UPDATE のみ(toilets を触らない)。
//   よって専用 RPC は不要(原子性が要るのは toilets+監査を同時に動かす apply 経路だけ = Codex 懸念 D への合意修正)。
//   ただし「pending のときだけ rejected にする」精密更新にして、二重処理(既に approved/rejected/auto_applied/no_op)を
//   .eq("status","pending") の precondition で弾く(0 行更新 = 既に終端 = 409)。単一行・単一テーブル更新なので原子的。
//
// 防御(既存 PATCH の guard 再利用):
//   ① getAdminSession → 401 ② isSameOrigin → 403 ③ suggestion id を uuid 検証 ④ noStore

async function guard(
  request: NextRequest,
  rawId: string,
): Promise<{ ok: true; id: string } | { ok: false; res: NextResponse }> {
  const session = await getAdminSession();
  if (!session) {
    return { ok: false, res: noStore(NextResponse.json({ error: "unauthorized" }, { status: 401 })) };
  }
  if (!isSameOrigin(request)) {
    return { ok: false, res: noStore(NextResponse.json({ error: "bad origin" }, { status: 403 })) };
  }
  if (!isUuid(rawId)) {
    return { ok: false, res: noStore(NextResponse.json({ error: "invalid id" }, { status: 400 })) };
  }
  return { ok: true, id: rawId };
}

// ai_apply_suggestion(jsonb)の戻りを受ける最小 shape。
type ApplySuggestionResult = {
  applied?: boolean;
  status?: string;
  edit_id?: string | null;
  changed_fields?: string[];
};

// RPC のエラーメッセージ('admin_rpc: <理由>')を HTTP に写す(生 DB 文言は返さない)。
//   ai_apply_suggestion 固有の理由 + admin_apply_edit から伝播する理由の両方をカバー。
function statusForRpcError(message: string): number {
  if (message.includes("suggestion not found")) return 404;
  if (message.includes("toilet not found")) return 404;
  if (message.includes("suggestion not pending")) return 409; // 既に処理済(二重反映防止)
  if (message.includes("invalid inferred_access")) return 400;
  // auto ガード(auto field/value/confidence)・invalid mode/editor 等は B1 の manual では起きない想定。
  //   起きたら呼び出し側のバグなので 500(想定外)に倒す。
  return 500;
}

function clientErrorFor(status: number): string {
  switch (status) {
    case 404:
      return "not found";
    case 409:
      return "conflict: already processed";
    case 400:
      return "invalid value";
    default:
      return "internal error";
  }
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const g = await guard(request, rawId);
  if (!g.ok) return g.res;
  const id = g.id;

  // body から action(+ 任意の reason)を取る。
  let action: string;
  let reason: string | null = null;
  try {
    const body = (await request.json()) as unknown;
    const a = (body as { action?: unknown })?.action;
    if (a !== "approve" && a !== "reject") {
      return noStore(NextResponse.json({ error: "action must be approve or reject" }, { status: 400 }));
    }
    action = a;
    const r = (body as { reason?: unknown })?.reason;
    if (typeof r === "string" && r.trim().length > 0) {
      reason = r.trim().slice(0, 300); // 却下理由は短く上限(運用メモ)。
    }
  } catch {
    return noStore(NextResponse.json({ error: "invalid json" }, { status: 400 }));
  }

  try {
    const supabase = getServerSupabaseSecret();

    if (action === "approve") {
      // ★ approve = ai_apply_suggestion(manual)。status 更新 + 反映 + 監査を単一 tx で(toilets 直更新しない)。
      // ⚠️ editor は 'ai'(= 反映値の出所 = LLM 抽出)、reviewed_by は RPC が p_mode から決める(= 処理者)。
      //   両者は別概念(出所 vs 処理者)。詳細は 014 ai_apply_suggestion の WHY。route 側で reviewed_by は触らない。
      const { data, error } = await supabase.rpc("ai_apply_suggestion", {
        p_suggestion_id: id,
        p_actor: "ai", // 反映の出所(admin_edits.editor)。AI 抽出由来の反映なので 'ai'(承認操作は人だが、根拠は AI)。
        p_mode: "manual", // 人が承認 = 標準 6 列 allowlist 許可(B1)。auto(bool3 限定)は B2。
        p_threshold: null, // manual では未使用。
      });

      if (error) {
        const status = statusForRpcError(error.message);
        if (status === 500) {
          console.error("[api/admin/suggestions] apply rpc error", error);
        }
        return noStore(NextResponse.json({ error: clientErrorFor(status) }, { status }));
      }

      const result = (data ?? {}) as ApplySuggestionResult;
      // applied=false は no-op(現在値と同値)。RPC 側で status='no_op' 終端化済み。200 で冪等に返す。
      return noStore(
        NextResponse.json({
          ok: true,
          applied: result.applied ?? false,
          status: result.status ?? null,
          changed: result.changed_fields ?? [],
        }),
      );
    }

    // ── action === "reject" ──
    // toilets を触らないので RPC 不要。pending のときだけ rejected に遷移(二重処理を 0 行更新で弾く)。
    // .select() を付けて更新行を返させ、0 行なら「既に終端」= 409 にする。
    const { data: updated, error } = await supabase
      .from("ai_suggestions")
      .update({
        status: "rejected",
        reviewed_by: "admin",
        reviewed_at: new Date().toISOString(),
        rejected_reason: reason,
      })
      .eq("id", id)
      .eq("status", "pending") // ★precondition: pending 以外(既に処理済)は更新しない = 二重処理防止
      .select("id");

    if (error) {
      console.error("[api/admin/suggestions] reject update error", error.code ?? error.message);
      return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
    }
    if (!updated || updated.length === 0) {
      // 該当 id が無い、または既に pending でない(approved/rejected/auto_applied/no_op)。
      //   どちらも「この却下操作は成立しない」= 409(already processed)に倒す
      //   (存在しない id を 404 と区別しないのは、提案 id は admin にしか見えず情報露出が無いため簡素化)。
      return noStore(NextResponse.json({ error: "conflict: already processed" }, { status: 409 }));
    }

    return noStore(NextResponse.json({ ok: true, status: "rejected" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[api/admin/suggestions] unexpected error", message);
    return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
  }
}
