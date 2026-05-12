// /area/[region] ランディングページが対象にするエリア一覧。
// = 既存の市プリセット REGIONS(キー: fukuoka-city など。ただし都道府県と重複する `*-pref` は除外)
//   + 47 都道府県(slug: jp-01 … jp-47)。
// bbox は [southLat, westLng, northLat, eastLng]。
// 表示名は messages/*.json の `areaNames` 名前空間(slug がキー)から locale 別に引く。
// `label` フィールドは日本語の正規名(translator が無い場面でのフォールバック)。

import { REGIONS, JP_PREFECTURES, type Region } from "@/lib/regions";

export type AreaKind = "city" | "prefecture";

export type Area = {
  slug: string;
  label: string; // 日本語の正規名(messages の areaNames が無い場合のフォールバック)
  bbox: [number, number, number, number];
  kind: AreaKind;
};

// 都道府県コード JP-40 → slug jp-40
export function prefectureSlug(code: string): string {
  return code.toLowerCase();
}

// `*-pref`(例: fukuoka-pref)は jp-NN の都道府県ページと重複するので /area には出さない。
const CITY_AREAS: Area[] = REGIONS.filter((r) => !r.key.endsWith("-pref")).map(
  (r: Region) => ({ slug: r.key, label: r.label, bbox: r.bbox, kind: "city" as const })
);

const PREF_AREAS: Area[] = JP_PREFECTURES.map((p) => ({
  slug: prefectureSlug(p.code),
  label: p.label,
  bbox: p.bbox,
  kind: "prefecture" as const,
}));

// 市プリセットを先に、その後に都道府県。findArea は city→pref の順で解決。
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

// messages/*.json の `areaNames` 名前空間の translator を渡してロケール別の地名を得る。
// 翻訳が見つからなければ日本語の正規名にフォールバック。
export function areaLabel(area: Area, t?: (key: string) => string): string {
  if (!t) return area.label;
  try {
    const v = t(area.slug);
    return v && v !== area.slug ? v : area.label;
  } catch {
    return area.label;
  }
}

// 緯度経度を含む都道府県エリア(なければ undefined)。bbox は概算なので複数候補ありうるが先頭を返す。
export function findContainingPrefecture(lat: number, lng: number): Area | undefined {
  return PREF_AREAS.find(
    (a) => lat >= a.bbox[0] && lat <= a.bbox[2] && lng >= a.bbox[1] && lng <= a.bbox[3]
  );
}
