import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabaseSecret } from "@/lib/supabase/server";
import { checkAndRecord, extractIp, hashIp } from "@/lib/rateLimit";
import { ACCESS_SET } from "@/types/toilet";
import { UUID_RE } from "@/lib/uuid";

export const runtime = "nodejs";

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

  // #24 — UUID 検証を rate-limit/insert より前に行う。
  // WHY ここで弾くか:
  //   checkAndRecord は in-memory キャッシュに `ipHash:toiletId` を書き込む。
  //   不正 toiletId(ランダム文字列など)でキャッシュが汚染されると、同 IP が 1 時間その
  //   バケットを消費し続ける(キャッシュ汚染)。また、DB に無効な UUID を送れば外部キー違反で
  //   500 が返るが、その前にレート枠を消費してしまうと「訂正して再送」ができなくなる。
  //   UUID 形式違反は入力エラー(400)なので、副作用を一切起こさず即時拒否するのが正しい。
  if (!toiletId || !UUID_RE.test(toiletId)) {
    return NextResponse.json({ error: "toiletId must be a valid UUID" }, { status: 400 });
  }

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

  if (!rating || !accessLevel) {
    return NextResponse.json({ error: "toiletId, rating, accessLevel are required" }, { status: 400 });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "rating must be integer 1-5" }, { status: 400 });
  }
  if (!ACCESS_SET.has(accessLevel as "open" | "ask" | "permission")) {
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
      // #21 — raw DB error は外部に返さない(スキーマ情報が漏れる)。サーバーログに記録してジェネリック応答。
      console.error("[api/reviews] insert error", error);
      return NextResponse.json({ error: "internal error" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    // #21 — 例外メッセージも外部には返さない(スタックトレース漏洩防止)。
    console.error("[api/reviews] unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
