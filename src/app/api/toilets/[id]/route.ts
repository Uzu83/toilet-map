import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabasePublishable } from "@/lib/supabase/server";
import { toToilet } from "@/lib/toilets";
import { UUID_RE } from "@/lib/uuid";

export const runtime = "nodejs";

// GET /api/toilets/[id] — id 指定でトイレ 1 件を返す(map の deep-link で使う)。
//
// WHY getToiletById() を使わないか(PR2 #13):
//   getToiletById() は RPC エラーを catch して null に潰す(SEO ページのビルド非破壊のため)。
//   その結果「RPC error」が「row なし = 404」に化けてしまう。
//   このルートは「RPC error → 500」「row なし → 404」を明確に区別して返したいので、
//   RPC を直接呼んで try/catch を自前で管理する。200 body の正規化だけ toToilet() に委任する。
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const supabase = getServerSupabasePublishable();
    const { data, error } = await supabase.rpc("toilet_by_id", { t_id: id });
    if (error) {
      // 生の Supabase エラーメッセージをそのまま返さない(内部スキーマ露出防止)。
      // WHY error.message を伏せる: PR2 #21 の error-leak 対応。詳細はサーバログのみ。
      console.error("[api/toilets/id] rpc error", error.message);
      return NextResponse.json({ error: "internal error" }, { status: 500 });
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // toToilet() で Toilet 型に正規化してから返す(以前は raw RPC 行をそのまま返していた)。
    return NextResponse.json({ toilet: toToilet(row as Record<string, unknown>) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    // 例外の生メッセージをクライアントに返さない(PR2 #21)。詳細はサーバログのみ。
    console.error("[api/toilets/id] unexpected error", message);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
