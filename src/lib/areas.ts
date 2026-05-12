// /area/[region] ランディングページが対象にするエリア一覧。
// = 既存の市プリセット REGIONS(キー: fukuoka-city など)+ 47 都道府県(slug: jp-01 … jp-47)。
// bbox は [southLat, westLng, northLat, eastLng]。

import { REGIONS, JP_PREFECTURES, type Region } from "@/lib/regions";

export type AreaKind = "city" | "prefecture";

export type Area = {
  slug: string;
  label: string; // 日本語の地名(地名なので i18n しない)
  bbox: [number, number, number, number];
  kind: AreaKind;
};

// 都道府県コード JP-40 → slug jp-40
export function prefectureSlug(code: string): string {
  return code.toLowerCase();
}

const CITY_AREAS: Area[] = REGIONS.map((r: Region) => ({
  slug: r.key,
  label: r.label,
  bbox: r.bbox,
  kind: "city" as const,
}));

const PREF_AREAS: Area[] = JP_PREFECTURES.map((p) => ({
  slug: prefectureSlug(p.code),
  label: p.label,
  bbox: p.bbox,
  kind: "prefecture" as const,
}));

// 市プリセットを先に、その後に都道府県。findArea は market→pref の順で解決。
export const ALL_AREAS: Area[] = [...CITY_AREAS, ...PREF_AREAS];

export function areaSlugs(): string[] {
  return ALL_AREAS.map((a) => a.slug);
}

export function findArea(slug: string): Area | undefined {
  const norm = slug.toLowerCase();
  return ALL_AREAS.find((a) => a.slug === norm);
}

// 県は近隣の県、市は同県の他都市… ではなく単純に「同 kind の前後数件」を返す軽い実装。
export function relatedAreas(area: Area, n = 8): Area[] {
  const pool = ALL_AREAS.filter((a) => a.kind === area.kind && a.slug !== area.slug);
  const idx = pool.findIndex((a) => a.slug > area.slug);
  const start = idx < 0 ? Math.max(0, pool.length - n) : Math.max(0, idx - Math.floor(n / 2));
  return pool.slice(start, start + n);
}

// プレフィックスなし(都道府県は ja の地名ラベルで十分)。
export function areaLabel(area: Area): string {
  return area.label;
}

// 緯度経度を含む都道府県エリア(なければ undefined)。bbox は概算なので複数候補ありうるが先頭を返す。
export function findContainingPrefecture(lat: number, lng: number): Area | undefined {
  return PREF_AREAS.find(
    (a) => lat >= a.bbox[0] && lat <= a.bbox[2] && lng >= a.bbox[1] && lng <= a.bbox[3]
  );
}
