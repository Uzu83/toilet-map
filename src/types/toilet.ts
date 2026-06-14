export type AccessLevel = "open" | "ask" | "permission";

// 色のみ。ラベル・説明は i18n メッセージ(messages/*.json の "access" 名前空間)から取得する。
export const ACCESS_COLORS: Record<AccessLevel, string> = {
  open: "#3B82F6",
  ask: "#F59E0B",
  permission: "#EF4444",
};

export const ACCESS_KEYS: AccessLevel[] = ["open", "ask", "permission"];

export type Toilet = {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  source: "osm" | "user" | "inferred";
  has_washlet: boolean | null;
  has_diaper_table: boolean | null;
  is_universal: boolean | null;
  review_count: number;
  avg_rating: number | null;
  dominant_access: AccessLevel | null;
  inferred_access: AccessLevel | null;
  opening_hours: string | null;
  not_a_toilet_count: number;
};

export type ReviewInput = {
  toiletId: string;
  rating: number;
  accessLevel: AccessLevel;
  hasWashlet: boolean | null;
  comment?: string;
  notAToilet?: boolean;
};

// pending 申請ピン。pending_submissions_in_bbox RPC(008)の戻り値に対応する表示用の最小形。
// ip_hash 等の個人データ・access_level/comment はピン表示に不要なため RPC で返さない(Codex #8)。
export type ToiletSubmission = {
  id: string;
  lat: number;
  lng: number;
  name: string | null;
  status: "pending" | "approved" | "rejected";
  confirm_count: number;
  created_at: string;
};

// 申請フォームの送信ペイロード(/api/submissions POST のボディ)。
export type SubmissionInput = {
  lat: number;
  lng: number;
  accessLevel: AccessLevel;
  name?: string;
  isOutdoor?: boolean;
  isUniversal?: boolean;
  comment?: string;
};

// ピンの最終表示色を決める(レビュー > 推定 > グレー)
export function effectiveAccess(t: Toilet): AccessLevel | null {
  if (t.dominant_access) return t.dominant_access;
  if (t.inferred_access) return t.inferred_access;
  return null;
}

// 「未確定」=推定だけ または レビュー10件未満
export function isUnconfirmed(t: Toilet): boolean {
  return t.review_count < 10;
}
