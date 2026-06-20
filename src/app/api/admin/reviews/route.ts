import { NextResponse } from "next/server";
import { noStore } from "@/lib/adminHttp";
import { getAdminSession } from "@/lib/adminSession";
import { getServerSupabaseSecret } from "@/lib/supabase/server";

// secret(SUPABASE_SECRET_KEY / ADMIN_SESSION_SECRET)を読むため Node ランタイム固定。
export const runtime = "nodejs";
// 管理系は静的化・キャッシュさせない(layout/login と同方針)。常にリクエスト毎にサーバで再検証。
export const dynamic = "force-dynamic";

// 一覧に出す最大件数。運営が「コメントに有用情報が埋もれている」レビューを拾う導線なので、
// 直近の有限件で十分(無限スクロール/ページャは Phase A では作らない=過剰実装回避)。
// ───────────────────────────────────────────────────────────────────
// なぜ「100」か(無制限でも 10 でもなく):
//   - 上限なし(.limit を外す): コメント付きレビューが将来数千件になるとレスポンス肥大 + Server Component
//     ページの初期描画が重くなり、関連 toilets の .in(toiletIds) も巨大化する。admin 画面の応答性が落ちる。
//   - 小さすぎる(例 10): 1 画面で運営が「未反映の有用コメント」を取りこぼし、編集の見落としが増える。
//   - 100 ≒ 「ソロ運営が 1 セッションで目視レビューして編集に回せる現実的な上限」。これを超えて溜まったら
//     ページャより「AI 抽出で半自動化(Phase B)」で捌く設計なので、ここを際限なく増やさない。
//   ★ admin/page.tsx の MAX_REVIEWS と同値であること(Server Component 初期表示と本 API の再取得で件数がズレると
//     編集後リフレッシュで一覧が変わって混乱する)。片方だけ変えない。
// PostgREST の 1 レスポンス上限(1000 行)未満なので内部ページングは不要(getToiletIdsPage のような分割は要らない)。
const MAX_REVIEWS = 100;

// GET /api/admin/reviews — コメント付きレビュー一覧 + 紐づくトイレの現在値を返す(運営の編集材料)。
//
// 防御: ① proxy で early gate 済みだが、ここでも cookie を再検証する(多層防御 / 権限の最終根拠)。
//   GET は副作用が無いので CSRF(Origin)チェックは課さない(設計書: isSameOrigin は変更系のみに適用)。
// PII: ip_hash は返さない(レビュー行から明示的に除外する。表示不要・個人データ相当 / R1#7)。
export async function GET() {
  // ① 認証 cookie 再検証。未認証は 401(proxy をすり抜けても最終的にここで止める)。
  const session = await getAdminSession();
  if (!session) {
    return noStore(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  }

  try {
    const supabase = getServerSupabaseSecret();

    // コメント付きレビューだけを直近順で取得する。
    // WHY ip_hash を select しない: PII を admin レスポンスに乗せない(列を明示列挙して取りこぼさない)。
    // WHY not_a_toilet は含める: 「使えなかった」報告も運営が文脈として見たい(編集判断に使う)。
    const { data: reviews, error: reviewErr } = await supabase
      .from("reviews")
      .select("id, toilet_id, rating, access_level, has_washlet, comment, not_a_toilet, created_at")
      .not("comment", "is", null)
      .neq("comment", "")
      .order("created_at", { ascending: false })
      .limit(MAX_REVIEWS);

    if (reviewErr) {
      // WHY 生の DB メッセージを返さない: PostgREST/Postgres のエラー文はテーブル名・列名・制約名等の
      //   内部スキーマを含みうる。詳細はサーバログ(上の console.error)に留め、クライアントには汎用文言を返す。
      console.error("[api/admin/reviews] select reviews error", reviewErr);
      return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
    }

    const rows = reviews ?? [];
    // レビューに紐づくトイレ id を distinct 化して、一括で現在値を引く(N+1 回避)。
    const toiletIds = Array.from(new Set(rows.map((r) => r.toilet_id as string)));

    // 編集対象トイレの現在値。allowlist フィールド + 表示に要る id/source を取る。
    // WHY 直接 toilets を select(RPC でなく): admin は集計(dominant_access 等)でなく「生の編集可能列」を
    //   見たい。toilets_in_bbox は location を bbox で絞る RPC なので id 指定の取得には不向き。
    type ToiletRow = {
      id: string;
      name: string | null;
      source: string;
      inferred_access: "open" | "ask" | "permission" | null;
      has_washlet: boolean | null;
      has_diaper_table: boolean | null;
      is_universal: boolean | null;
      opening_hours: string | null;
    };
    const toiletsById: Record<string, ToiletRow> = {};
    if (toiletIds.length > 0) {
      const { data: toilets, error: toiletErr } = await supabase
        .from("toilets")
        .select(
          "id, name, source, inferred_access, has_washlet, has_diaper_table, is_universal, opening_hours",
        )
        .in("id", toiletIds);
      if (toiletErr) {
        // 生の DB メッセージは伏せる(内部スキーマ露出防止)。詳細はサーバログのみ。
        console.error("[api/admin/reviews] select toilets error", toiletErr);
        return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
      }
      for (const t of (toilets ?? []) as ToiletRow[]) {
        toiletsById[t.id] = t;
      }
    }

    // レビューの形を返す。ip_hash は select していないので構造的に漏れない(防御の二重化)。
    return noStore(
      NextResponse.json({
        reviews: rows.map((r) => ({
          id: r.id,
          toiletId: r.toilet_id,
          rating: r.rating,
          accessLevel: r.access_level,
          hasWashlet: r.has_washlet,
          comment: r.comment,
          notAToilet: r.not_a_toilet,
          createdAt: r.created_at,
        })),
        // トイレの現在値(編集フォームの初期値に使う)。
        toilets: toiletsById,
      }),
    );
  } catch (err) {
    // 例外の生メッセージはクライアントに返さない(内部情報の露出防止)。詳細はサーバログのみ。
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[api/admin/reviews] unexpected error", message);
    return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
  }
}
