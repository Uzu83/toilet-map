import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabaseSecret } from "@/lib/supabase/server";
import { checkAndRecord, extractIp, hashIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

const ACCESS_VALUES = new Set(["open", "ask", "permission"]);

type ReviewBody = {
  toiletId?: unknown;
  rating?: unknown;
  accessLevel?: unknown;
  hasWashlet?: unknown;
  comment?: unknown;
  notAToilet?: unknown;
};

export async function POST(request: NextRequest) {
  let body: ReviewBody;
  try {
    body = (await request.json()) as ReviewBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const toiletId = typeof body.toiletId === "string" ? body.toiletId : null;
  const notAToilet = body.notAToilet === true;
  // 「ここトイレない」報告は rating/accessLevel をデフォルト埋めで受け付ける
  const rating = typeof body.rating === "number" ? body.rating : notAToilet ? 1 : null;
  const accessLevel =
    typeof body.accessLevel === "string"
      ? body.accessLevel
      : notAToilet
      ? "permission"
      : null;
  const hasWashlet =
    typeof body.hasWashlet === "boolean" ? body.hasWashlet : null;
  const comment =
    typeof body.comment === "string" && body.comment.trim() !== ""
      ? body.comment.slice(0, 500)
      : null;

  if (!toiletId || !rating || !accessLevel) {
    return NextResponse.json({ error: "toiletId, rating, accessLevel are required" }, { status: 400 });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "rating must be integer 1-5" }, { status: 400 });
  }
  if (!ACCESS_VALUES.has(accessLevel)) {
    return NextResponse.json({ error: "invalid accessLevel" }, { status: 400 });
  }

  const ipHash = hashIp(extractIp(request));
  const limit = checkAndRecord(ipHash, toiletId);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "同じトイレへの投稿は1時間に1回までです" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } }
    );
  }

  try {
    const supabase = getServerSupabaseSecret();
    const { error } = await supabase.from("reviews").insert({
      toilet_id: toiletId,
      rating,
      access_level: accessLevel,
      has_washlet: hasWashlet,
      comment,
      ip_hash: ipHash,
      not_a_toilet: notAToilet,
    });
    if (error) {
      console.error("[api/reviews] insert error", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
