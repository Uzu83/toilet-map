import { NextResponse, type NextRequest } from "next/server";
import { clientMessageFor, noStore, requireAdminMutation, rpcStatusFor } from "@/lib/adminHttp";
import { getServerSupabaseSecret } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/submissions/[id] — pending のトイレ申請を承認または却下する。
//
// body: { action: "approve" | "reject", reason?: string }
//
// approve / reject はどちらも admin_decide_submission RPC。
// 承認は RPC 内で toilets へ source='user' の INSERT のみ(既存行は UPDATE しない)。
// 却下は status を rejected にするだけで toilets を作らない。
// この route から toilets を直接 insert/update しない。

const SUBMISSION_RPC_ERRORS: ReadonlyArray<[string, number]> = [
  ["submission not found", 404],
  ["submission not pending", 409],
  ["nearby toilet exists", 409],
  ["invalid action", 400],
];

const SUBMISSION_CONFLICT_TEXT = "conflict: already processed";

type DecideResult = {
  result?: string;
  status?: string;
  toilet_id?: string | null;
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
    const { data, error } = await supabase.rpc("admin_decide_submission", {
      p_submission_id: id,
      p_action: action,
      p_reason: reason,
    });

    if (error) {
      if (error.message.includes("nearby toilet exists")) {
        return noStore(
          NextResponse.json({ error: "conflict: nearby toilet exists" }, { status: 409 }),
        );
      }
      const status = rpcStatusFor(error.message, SUBMISSION_RPC_ERRORS);
      if (status === 500) {
        console.error("[api/admin/submissions] decide rpc error", error);
      }
      return noStore(
        NextResponse.json({ error: clientMessageFor(status, SUBMISSION_CONFLICT_TEXT) }, { status }),
      );
    }

    const result = (data ?? {}) as DecideResult;
    return noStore(
      NextResponse.json({
        ok: true,
        result: result.result ?? action,
        status: result.status ?? null,
        toiletId: result.toilet_id ?? null,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[api/admin/submissions] unexpected error", message);
    return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
  }
}
