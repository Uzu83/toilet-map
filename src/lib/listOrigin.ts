import { HAKATA_STATION } from "@/lib/geo";

export type SearchOrigin = {
  lat: number;
  lng: number;
  label: string;
};

export type DistanceMode = "here" | "search";

export type ResolveListOriginInput = {
  distanceMode: DistanceMode;
  userPos: { lat: number; lng: number } | null;
  searchOrigin: SearchOrigin | null;
};

/** リスト距離・ソート・方角の原点。search は mode=search かつ searchOrigin があるときだけ。 */
export function resolveListOrigin(input: ResolveListOriginInput): { lat: number; lng: number } {
  const { distanceMode, userPos, searchOrigin } = input;
  if (distanceMode === "search" && searchOrigin) {
    return { lat: searchOrigin.lat, lng: searchOrigin.lng };
  }
  return userPos ?? HAKATA_STATION;
}

/** 検索地点を選んだあとは GPS 更新で地図を引き戻さない。 */
export function shouldFlyToGps(searchOrigin: SearchOrigin | null): boolean {
  return searchOrigin === null;
}

export function parseNominatimSearchOrigin(r: {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
}): SearchOrigin | null {
  const lat = parseFloat(r.lat);
  const lng = parseFloat(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    label: r.name ?? r.display_name.split(",")[0] ?? "",
  };
}
