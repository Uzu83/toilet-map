import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/adminSession";
import { getServerSupabaseSecret } from "@/lib/supabase/server";
import { EDITABLE_FIELDS, type EditableField } from "@/lib/adminAuth";
import { ADMIN_MAX_REVIEWS } from "@/lib/adminConstants";
import {
  AdminDashboard,
  type AdminReview,
  type AdminToilet,
  type AdminEditLog,
  type AdminSuggestion,
  type AdminPendingSubmission,
  type AdminFacilityClaim,
  type FacilityClaimField,
} from "./Dashboard";

// secret(SUPABASE_SECRET_KEY / ADMIN_SESSION_SECRET)を読むため Node ランタイム固定。
export const runtime = "nodejs";
// 管理 HTML を静的生成・キャッシュさせない(layout と同方針 / proxy すり抜け時の漏洩防止)。
export const dynamic = "force-dynamic";
// 「直近の編集履歴」に出す件数。取消ボタンの材料 = 直近の操作だけ見えれば十分なので浅く 30 件で打ち切る。
//   多すぎると古い edit が並ぶが、取消は各トイレの「最新 edit のみ」しか効かない(admin_undo_edit の不変条件)ので
//   履歴を深く出しても操作性は上がらず、描画と DB スキャンが重くなるだけ。完全な監査閲覧は Supabase dashboard 側で行う。
const MAX_EDIT_LOG = 30;
// AI 提案キュー(status='pending')に出す件数。承認/却下を 1 セッションで捌ける現実的上限。
//   B1 は「全件 pending に積んで人が全ループ内で観察」する段階なので、溜まりすぎたらここで打ち切り
//   (それ以上は Supabase dashboard で確認 / B2 の自動反映で母数を減らす)。MAX_REVIEWS と同思想で 50。
const MAX_SUGGESTIONS = 50;
// 投稿キュー / 設備キュー。1 セッションで捌ける件数。それ以上は Supabase dashboard。
const MAX_QUEUE = 50;

// /admin ダッシュボード(Server Component)。
// WHY サーバ側で直接 Supabase を引く(API を fetch しない): Server Component は同一プロセスで
//   secret key を使えるので、自分宛ての HTTP を往復するより速く単純。/api/admin/reviews は
//   クライアント側の再取得(編集後リフレッシュ等)用に別途存在する。
export default async function AdminPage() {
  // 多層防御: proxy で弾いた上で、ページ本体でも cookie を再検証する(権限の最終根拠)。
  const session = await getAdminSession();
  if (!session) {
    // 未認証はログインへ。proxy が機能していれば基本ここには来ないが、保険として必ず確認する。
    redirect("/admin/login");
  }

  const supabase = getServerSupabaseSecret();

  // コメント付きレビュー(直近順)。ip_hash は select しない(PII を画面に出さない)。
  const { data: reviewRows } = await supabase
    .from("reviews")
    .select("id, toilet_id, rating, access_level, has_washlet, comment, not_a_toilet, created_at")
    .not("comment", "is", null)
    .neq("comment", "")
    .order("created_at", { ascending: false })
    .limit(ADMIN_MAX_REVIEWS);

  // pending の新規トイレ申請。ip_hash は RPC が返さない。失敗(20261127213301 未適用)でも他セクションは出す。
  const { data: submissionRows, error: submissionErr } = await supabase.rpc(
    "admin_pending_submissions",
    { p_limit: MAX_QUEUE },
  );
  if (submissionErr) {
    console.error("[admin] pending submissions", submissionErr.code ?? submissionErr.message);
  }
  const submissions: AdminPendingSubmission[] = (
    (submissionRows ?? []) as Array<Record<string, unknown>>
  ).map((s) => ({
    id: s.id as string,
    name: (s.name as string | null) ?? null,
    accessLevel: s.access_level as string,
    isOutdoor: (s.is_outdoor as boolean | null) ?? null,
    isUniversal: (s.is_universal as boolean | null) ?? null,
    comment: (s.comment as string | null) ?? null,
    confirmCount: (s.confirm_count as number) ?? 0,
    lat: s.lat as number,
    lng: s.lng as number,
    createdAt: s.created_at as string,
  }));

  const { data: claimRows, error: claimErr } = await supabase
    .from("review_facility_claims")
    .select("id, review_id, toilet_id, field, value, created_at")
    .eq("status", "pending")
    .order("seq", { ascending: false })
    .limit(MAX_QUEUE);
  if (claimErr) {
    console.error("[admin] facility claims", claimErr.code ?? claimErr.message);
  }

  const claimReviewIds = Array.from(
    new Set((claimRows ?? []).map((c) => c.review_id as string)),
  );
  const claimComments: Record<string, string | null> = {};
  if (claimReviewIds.length > 0) {
    const { data: claimReviewRows } = await supabase
      .from("reviews")
      .select("id, comment")
      .in("id", claimReviewIds);
    for (const r of claimReviewRows ?? []) {
      claimComments[r.id as string] = (r.comment as string | null) ?? null;
    }
  }

  const facilityClaims: AdminFacilityClaim[] = (claimRows ?? []).map((c) => ({
    id: c.id as string,
    reviewId: c.review_id as string,
    toiletId: c.toilet_id as string,
    field: c.field as FacilityClaimField,
    value: c.value as boolean | string,
    comment: claimComments[c.review_id as string] ?? null,
    createdAt: c.created_at as string,
  }));

  const queueWarning =
    submissionErr || claimErr
      ? "承認キューを読めません。migration 20261127213301 が未適用の可能性があります。"
      : null;

  const reviews: AdminReview[] = (reviewRows ?? []).map((r) => ({
    id: r.id as string,
    toiletId: r.toilet_id as string,
    rating: r.rating as number,
    accessLevel: r.access_level as string,
    hasWashlet: r.has_washlet as boolean | null,
    comment: r.comment as string,
    notAToilet: r.not_a_toilet as boolean,
    createdAt: r.created_at as string,
  }));

  // AI 提案キュー(status='pending')を新しい順に取得する(B1: 手動 approve/reject の材料)。
  //   ★ order by seq desc(created_at desc では駄目)— admin_edits と同思想。seq は挿入順に厳密単調・タイ無し
  //     なので「最新の pending が先頭」が決定的。created_at は default now() でタイ非決定なので順序に使わない。
  const { data: suggestionRows } = await supabase
    .from("ai_suggestions")
    .select("id, toilet_id, review_id, field, value, confidence, evidence, created_at")
    .eq("status", "pending")
    .order("seq", { ascending: false })
    .limit(MAX_SUGGESTIONS);

  const suggestions: AdminSuggestion[] = (suggestionRows ?? []).map((s) => ({
    id: s.id as string,
    toiletId: s.toilet_id as string,
    reviewId: (s.review_id as string | null) ?? null,
    field: s.field as EditableField,
    // value は jsonb(string | boolean)。表示は文字列化して扱う(approve は id を送るだけなので値は表示専用)。
    value: s.value as string | boolean | null,
    confidence: (s.confidence as number | null) ?? null,
    evidence: (s.evidence as string | null) ?? null,
    createdAt: s.created_at as string,
  }));

  // 関連トイレの現在値(編集フォーム初期値 + 提案の「現在値 → 提案値」表示)。
  //   レビュー由来トイレ + 提案由来トイレの両方を union して 1 回でまとめて引く(提案が参照するトイレが
  //   レビュー一覧に無いケースに備える)。
  const toiletIds = Array.from(
    new Set([
      ...reviews.map((r) => r.toiletId),
      ...suggestions.map((s) => s.toiletId),
      ...facilityClaims.map((c) => c.toiletId),
    ]),
  );
  const toilets: Record<string, AdminToilet> = {};
  if (toiletIds.length > 0) {
    const { data: toiletRows } = await supabase
      .from("toilets")
      .select(`id, source, has_paper, has_soap, ${EDITABLE_FIELDS.join(", ")}`)
      .in("id", toiletIds);
    // supabase-js は動的 select 文字列を静的解析できず ParserError 型を推論するため、
    // unknown 経由で実行時に保証している shape へキャストする(列名は EDITABLE_FIELDS と一致)。
    for (const t of (toiletRows ?? []) as unknown as Record<string, unknown>[]) {
      const id = t.id as string;
      const at: AdminToilet = {
        id,
        source: (t.source as string) ?? "osm",
        name: (t.name as string | null) ?? null,
        inferred_access: (t.inferred_access as AdminToilet["inferred_access"]) ?? null,
        has_washlet: (t.has_washlet as boolean | null) ?? null,
        has_paper: (t.has_paper as boolean | null) ?? null,
        has_soap: (t.has_soap as boolean | null) ?? null,
        has_diaper_table: (t.has_diaper_table as boolean | null) ?? null,
        is_universal: (t.is_universal as boolean | null) ?? null,
        opening_hours: (t.opening_hours as string | null) ?? null,
      };
      toilets[id] = at;
    }
  }

  // 直近の監査履歴(全トイレ横断、新しい順)。取消ボタンの材料。
  // ★ order by edit_seq desc(created_at desc では駄目)— Codex R2[high]。
  //   UI の「最新」と DB(admin_undo_edit)の「最新」を同じ単調列 edit_seq で一致させる。
  //   created_at は default now() でタイ非決定 + uuid 非単調なので順序判定には使わない(表示専用)。
  //   UI が created_at 順だと「先頭に見えている行」と「DB が最新と判定する行」がズレ、取消ボタンの
  //   isLatestForToilet 表示が DB の 409 判定と食い違う。順序の唯一の真実は edit_seq。
  const { data: editRows } = await supabase
    .from("admin_edits")
    .select("id, edit_seq, toilet_id, editor, changed_fields, before, after, created_at")
    .order("edit_seq", { ascending: false })
    .limit(MAX_EDIT_LOG);

  const edits: AdminEditLog[] = (editRows ?? []).map((e) => ({
    id: e.id as string,
    toiletId: e.toilet_id as string,
    editor: e.editor as string,
    changedFields: (e.changed_fields as EditableField[]) ?? [],
    before: (e.before as Record<string, unknown>) ?? {},
    after: (e.after as Record<string, unknown>) ?? {},
    createdAt: e.created_at as string,
  }));

  return (
    <AdminDashboard
      reviews={reviews}
      toilets={toilets}
      edits={edits}
      suggestions={suggestions}
      submissions={submissions}
      facilityClaims={facilityClaims}
      queueWarning={queueWarning}
    />
  );
}
