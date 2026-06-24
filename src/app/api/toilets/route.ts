import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabasePublishable } from "@/lib/supabase/server";
import { parseBbox } from "@/lib/geo";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // bbox 欠落と「フォーマット不正」で 400 メッセージを出し分ける(リファクタ前の挙動を厳密維持)。
  // parseBbox は欠落・不正の両ケースで null を返すため、まず raw の有無で "bbox required" を、
  // 値はあるがパース不能な場合だけ "bbox format:..." を返す(2 種のレスポンス body を保つ)。
  const raw = request.nextUrl.searchParams.get("bbox");
  if (!raw) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }
  const parsed = parseBbox(raw);
  if (!parsed) {
    return NextResponse.json({ error: "bbox format: minLng,minLat,maxLng,maxLat" }, { status: 400 });
  }
  const [minLng, minLat, maxLng, maxLat] = parsed;

  try {
    const supabase = getServerSupabasePublishable();
    const { data, error } = await supabase.rpc("toilets_in_bbox", {
      min_lng: minLng,
      min_lat: minLat,
      max_lng: maxLng,
      max_lat: maxLat,
      result_limit: 500,
    });
    if (error) {
      // #21 — raw DB error は外部に返さない(スキーマ情報が漏れる)。サーバーログに記録してジェネリック応答。
      console.error("[api/toilets] supabase error", error);
      return NextResponse.json({ error: "internal error" }, { status: 500 });
    }
    return NextResponse.json({ toilets: data ?? [] });
  } catch (err) {
    // #21 — 例外メッセージも外部には返さない。
    console.error("[api/toilets] unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
