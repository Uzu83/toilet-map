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
  source: "osm" | "user";
  has_washlet: boolean | null;
  has_diaper_table: boolean | null;
  is_universal: boolean | null;
  review_count: number;
  avg_rating: number | null;
  dominant_access: AccessLevel | null;
};

export type ReviewInput = {
  toiletId: string;
  rating: number;
  accessLevel: AccessLevel;
  hasWashlet: boolean | null;
  comment?: string;
};
