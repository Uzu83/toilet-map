// シード用の地域 bbox プリセット
// bbox = [southLat, westLng, northLat, eastLng]
// MVP は fukuoka-city、公開後は fukuoka-pref + tokoy-23 + 順次全国

export type Region = {
  key: string;
  label: string;
  bbox: [number, number, number, number];
};

export const REGIONS: Region[] = [
  {
    key: "fukuoka-city",
    label: "福岡市",
    bbox: [33.52, 130.30, 33.72, 130.50],
  },
  {
    key: "fukuoka-pref",
    label: "福岡県",
    bbox: [33.10, 130.00, 33.95, 131.20],
  },
  {
    key: "tokyo-23",
    label: "東京23区",
    bbox: [35.50, 139.55, 35.85, 139.92],
  },
  {
    key: "osaka",
    label: "大阪市",
    bbox: [34.55, 135.40, 34.78, 135.62],
  },
  {
    key: "nagoya",
    label: "名古屋市",
    bbox: [35.05, 136.80, 35.25, 137.00],
  },
  {
    key: "sapporo",
    label: "札幌市",
    bbox: [42.95, 141.20, 43.18, 141.50],
  },
  {
    key: "sendai",
    label: "仙台市",
    bbox: [38.18, 140.78, 38.40, 141.00],
  },
  {
    key: "yokohama",
    label: "横浜市",
    bbox: [35.30, 139.45, 35.60, 139.75],
  },
  {
    key: "kyoto",
    label: "京都市",
    bbox: [34.90, 135.65, 35.10, 135.85],
  },
  {
    key: "kobe",
    label: "神戸市",
    bbox: [34.60, 135.05, 34.80, 135.30],
  },
  {
    key: "hiroshima",
    label: "広島市",
    bbox: [34.30, 132.35, 34.50, 132.55],
  },
];

export function findRegion(key: string): Region | undefined {
  return REGIONS.find((r) => r.key === key);
}

// 47 都道府県(ISO 3166-2:JP コード)。Overpass の area フィルタで境界を厳密に取得する。
export type Prefecture = { code: string; label: string };

export const JP_PREFECTURES: Prefecture[] = [
  { code: "JP-01", label: "北海道" },
  { code: "JP-02", label: "青森県" },
  { code: "JP-03", label: "岩手県" },
  { code: "JP-04", label: "宮城県" },
  { code: "JP-05", label: "秋田県" },
  { code: "JP-06", label: "山形県" },
  { code: "JP-07", label: "福島県" },
  { code: "JP-08", label: "茨城県" },
  { code: "JP-09", label: "栃木県" },
  { code: "JP-10", label: "群馬県" },
  { code: "JP-11", label: "埼玉県" },
  { code: "JP-12", label: "千葉県" },
  { code: "JP-13", label: "東京都" },
  { code: "JP-14", label: "神奈川県" },
  { code: "JP-15", label: "新潟県" },
  { code: "JP-16", label: "富山県" },
  { code: "JP-17", label: "石川県" },
  { code: "JP-18", label: "福井県" },
  { code: "JP-19", label: "山梨県" },
  { code: "JP-20", label: "長野県" },
  { code: "JP-21", label: "岐阜県" },
  { code: "JP-22", label: "静岡県" },
  { code: "JP-23", label: "愛知県" },
  { code: "JP-24", label: "三重県" },
  { code: "JP-25", label: "滋賀県" },
  { code: "JP-26", label: "京都府" },
  { code: "JP-27", label: "大阪府" },
  { code: "JP-28", label: "兵庫県" },
  { code: "JP-29", label: "奈良県" },
  { code: "JP-30", label: "和歌山県" },
  { code: "JP-31", label: "鳥取県" },
  { code: "JP-32", label: "島根県" },
  { code: "JP-33", label: "岡山県" },
  { code: "JP-34", label: "広島県" },
  { code: "JP-35", label: "山口県" },
  { code: "JP-36", label: "徳島県" },
  { code: "JP-37", label: "香川県" },
  { code: "JP-38", label: "愛媛県" },
  { code: "JP-39", label: "高知県" },
  { code: "JP-40", label: "福岡県" },
  { code: "JP-41", label: "佐賀県" },
  { code: "JP-42", label: "長崎県" },
  { code: "JP-43", label: "熊本県" },
  { code: "JP-44", label: "大分県" },
  { code: "JP-45", label: "宮崎県" },
  { code: "JP-46", label: "鹿児島県" },
  { code: "JP-47", label: "沖縄県" },
];

export function findPrefecture(code: string): Prefecture | undefined {
  const norm = code.toUpperCase().startsWith("JP-") ? code.toUpperCase() : `JP-${code}`;
  return JP_PREFECTURES.find((p) => p.code === norm);
}
