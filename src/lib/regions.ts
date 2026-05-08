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
