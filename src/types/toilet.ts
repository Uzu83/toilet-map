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
