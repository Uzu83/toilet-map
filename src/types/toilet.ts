export type AccessLevel = "open" | "ask" | "permission";

export const ACCESS_LEVELS: Record<
  AccessLevel,
  { label: string; color: string; description: string }
> = {
  open: {
    label: "声かけ不要",
    color: "#3B82F6",
    description: "コンビニ・駅・公衆トイレなど、訪れるだけで使える",
  },
  ask: {
    label: "一声かけて",
    color: "#F59E0B",
    description: "オフィスビル・店舗など、ひとこと声をかけて使う",
  },
  permission: {
    label: "許可が必要",
    color: "#EF4444",
    description: "ホテル・会員制施設など、利用許可をもらう必要あり",
  },
};

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
