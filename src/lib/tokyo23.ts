// /area/tokyo-23 の一覧を23区の中だけにする。
// エリアの bbox は矩形で、所沢・横浜・川崎・松戸など隣市を含む。
// toilets_in_region の geography && も矩形の外を拾うので、返った点を区界で落とす。

import { TOKYO_23_RINGS } from "@/lib/tokyo23Boundary";

// レビュー順の RPC は隣市の行も上位に出す。区界で落としたあと 180 件を残すため、
// PostgREST が1応答で返す上限まで取ってから絞る。
export const TOKYO_23_FETCH_LIMIT = 1000;

function pointInRing(
  lng: number,
  lat: number,
  ring: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const n = closed ? ring.length - 1 : ring.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat) {
      const xint = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (lng < xint) inside = !inside;
    }
    j = i;
  }
  return inside;
}

export function isInTokyo23Wards(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return TOKYO_23_RINGS.some((ring) => pointInRing(lng, lat, ring));
}

export function toiletsForAreaList<T extends { lat: number; lng: number }>(
  slug: string,
  toilets: readonly T[],
  limit: number,
): T[] {
  const rows =
    slug === "tokyo-23" ? toilets.filter((t) => isInTokyo23Wards(t.lat, t.lng)) : toilets;
  return rows.slice(0, limit);
}
