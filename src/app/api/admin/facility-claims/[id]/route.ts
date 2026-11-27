import { NextResponse, type NextRequest } from "next/server";
import { clientMessageFor, noStore, requireAdminMutation, rpcStatusFor } from "@/lib/adminHttp";
import { getServerSupabaseSecret } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/facility-claims/[id] — レビュー起点の設備を承認または却下する。
//
// 承認は admin_decide_facility_claim → admin_apply_edit。toilets 列の更新と admin_edits は RPC 内。
// 却下は RPC が status を rejected にするだけで、toilets を更新しない。
// この route から toilets を直接 update しない(OSM 行を含む既存ピンの無断上書きを避ける)。

const CLAIM_RPC_ERRORS: ReadonlyArray<[string, number]> = [
  ["claim not found", 404],
  ["toilet not found", 404],
  ["claim not pending", 409],
  ["invalid facility value", 400],
  ["opening_hours too long", 400],
  ["invalid action", 400],
];

const CLAIM_CONFLICT_TEXT = "conflict: already processed";

type DecideResult = {
  applied?: boolean;
  status?: string;
  edit_id?: string | null;
  changed_fields?: string[];
};

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const g = await requireAdminMutation(request, rawId);
  if (!g.ok) return g.res;
  const id = g.id!;

  let action: "approve" | "reject";
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
      reason = r.trim().slice(0, 300);
    }
  } catch {
    return noStore(NextResponse.json({ error: "invalid json" }, { status: 400 }));
  }

  try {
    const supabase = getServerSupabaseSecret();
    const { data, error } = await supabase.rpc("admin_decide_facility_claim", {
      p_claim_id: id,
      p_action: action,
      p_reason: reason,
    });

    if (error) {
      const status = rpcStatusFor(error.message, CLAIM_RPC_ERRORS);
      if (status === 500) {
        console.error("[api/admin/facility-claims] decide rpc error", error);
      }
      return noStore(
        NextResponse.json({ error: clientMessageFor(status, CLAIM_CONFLICT_TEXT) }, { status }),
      );
    }

    const result = (data ?? {}) as DecideResult;
    return noStore(
      NextResponse.json({
        ok: true,
        applied: result.applied ?? false,
        status: result.status ?? null,
        changed: result.changed_fields ?? [],
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[api/admin/facility-claims] unexpected error", message);
    return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
  }
}
