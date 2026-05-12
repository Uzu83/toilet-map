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
// bbox は SEO の /area ページ用の概算境界([southLat, westLng, northLat, eastLng]、約 0.1° 精度)。
// シード自体は area["ISO3166-2"=...] で厳密取得するので bbox の粗さは影響しない。
export type Prefecture = {
  code: string;
  label: string;
  bbox: [number, number, number, number];
};

export const JP_PREFECTURES: Prefecture[] = [
  { code: "JP-01", label: "北海道", bbox: [41.3, 139.3, 45.6, 145.9] },
  { code: "JP-02", label: "青森県", bbox: [40.2, 139.4, 41.6, 141.7] },
  { code: "JP-03", label: "岩手県", bbox: [38.7, 140.6, 40.5, 142.1] },
  { code: "JP-04", label: "宮城県", bbox: [37.7, 140.2, 39.0, 141.7] },
  { code: "JP-05", label: "秋田県", bbox: [38.8, 139.6, 40.5, 141.0] },
  { code: "JP-06", label: "山形県", bbox: [37.7, 139.5, 39.2, 140.6] },
  { code: "JP-07", label: "福島県", bbox: [36.7, 139.1, 38.0, 141.1] },
  { code: "JP-08", label: "茨城県", bbox: [35.7, 139.6, 36.95, 140.9] },
  { code: "JP-09", label: "栃木県", bbox: [36.2, 139.3, 37.2, 140.3] },
  { code: "JP-10", label: "群馬県", bbox: [35.9, 138.4, 37.1, 139.7] },
  { code: "JP-11", label: "埼玉県", bbox: [35.7, 138.7, 36.3, 139.9] },
  { code: "JP-12", label: "千葉県", bbox: [34.8, 139.7, 36.1, 140.9] },
  { code: "JP-13", label: "東京都", bbox: [35.5, 138.9, 35.9, 139.95] },
  { code: "JP-14", label: "神奈川県", bbox: [35.1, 139.0, 35.7, 139.8] },
  { code: "JP-15", label: "新潟県", bbox: [36.7, 137.6, 38.6, 139.9] },
  { code: "JP-16", label: "富山県", bbox: [36.3, 136.8, 36.99, 137.8] },
  { code: "JP-17", label: "石川県", bbox: [36.0, 136.2, 37.6, 137.4] },
  { code: "JP-18", label: "福井県", bbox: [35.3, 135.4, 36.3, 136.5] },
  { code: "JP-19", label: "山梨県", bbox: [35.2, 138.2, 35.97, 139.15] },
  { code: "JP-20", label: "長野県", bbox: [35.2, 137.3, 37.0, 138.75] },
  { code: "JP-21", label: "岐阜県", bbox: [35.1, 136.2, 36.5, 137.65] },
  { code: "JP-22", label: "静岡県", bbox: [34.6, 137.5, 35.65, 139.2] },
  { code: "JP-23", label: "愛知県", bbox: [34.6, 136.6, 35.4, 137.85] },
  { code: "JP-24", label: "三重県", bbox: [33.7, 135.85, 35.3, 136.95] },
  { code: "JP-25", label: "滋賀県", bbox: [34.8, 135.7, 35.7, 136.45] },
  { code: "JP-26", label: "京都府", bbox: [34.7, 134.85, 35.8, 136.05] },
  { code: "JP-27", label: "大阪府", bbox: [34.25, 135.1, 35.05, 135.75] },
  { code: "JP-28", label: "兵庫県", bbox: [34.15, 134.25, 35.7, 135.5] },
  { code: "JP-29", label: "奈良県", bbox: [33.85, 135.55, 34.8, 136.15] },
  { code: "JP-30", label: "和歌山県", bbox: [33.4, 135.0, 34.4, 136.05] },
  { code: "JP-31", label: "鳥取県", bbox: [35.05, 133.1, 35.65, 134.5] },
  { code: "JP-32", label: "島根県", bbox: [34.3, 131.6, 36.4, 133.5] },
  { code: "JP-33", label: "岡山県", bbox: [34.3, 133.25, 35.35, 134.4] },
  { code: "JP-34", label: "広島県", bbox: [34.0, 132.0, 35.1, 133.5] },
  { code: "JP-35", label: "山口県", bbox: [33.7, 130.75, 34.8, 132.5] },
  { code: "JP-36", label: "徳島県", bbox: [33.5, 133.6, 34.25, 134.8] },
  { code: "JP-37", label: "香川県", bbox: [34.0, 133.45, 34.55, 134.45] },
  { code: "JP-38", label: "愛媛県", bbox: [32.9, 132.0, 34.3, 133.7] },
  { code: "JP-39", label: "高知県", bbox: [32.7, 132.45, 33.9, 134.3] },
  { code: "JP-40", label: "福岡県", bbox: [33.0, 130.0, 34.0, 131.2] },
  { code: "JP-41", label: "佐賀県", bbox: [32.95, 129.7, 33.65, 130.55] },
  { code: "JP-42", label: "長崎県", bbox: [32.55, 128.55, 34.75, 130.45] },
  { code: "JP-43", label: "熊本県", bbox: [32.1, 129.95, 33.25, 131.35] },
  { code: "JP-44", label: "大分県", bbox: [32.7, 130.8, 33.75, 132.1] },
  { code: "JP-45", label: "宮崎県", bbox: [31.35, 130.7, 32.85, 131.9] },
  { code: "JP-46", label: "鹿児島県", bbox: [27.0, 128.3, 32.2, 131.2] },
  { code: "JP-47", label: "沖縄県", bbox: [24.0, 122.9, 27.9, 131.4] },
];

export function findPrefecture(code: string): Prefecture | undefined {
  const norm = code.toUpperCase().startsWith("JP-") ? code.toUpperCase() : `JP-${code}`;
  return JP_PREFECTURES.find((p) => p.code === norm);
}
