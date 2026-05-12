// サーバー専用: SEO ページ(/toilet/[id]、/area/[region]、sitemap)向けの Supabase 読み取りヘルパ。
// すべて publishable key の読み取り(RLS で select は公開)。失敗時は null / [] / 0 にフォールバックする
// ので、Supabase 障害やビルド時の env 欠落でもページ・ビルドが落ちない。

import { getServerSupabasePublishable } from "@/lib/supabase/server";
import type { Toilet } from "@/types/toilet";
import { isUuid } from "@/lib/uuid";
import { haversineMeters } from "@/lib/geo";

// RPC が返す行 → Toilet 型(boolean/null をそのまま受ける)
function toToilet(row: Record<string, unknown>): Toilet {
  return {
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    lat: Number(row.lat),
    lng: Number(row.lng),
    source: (row.source as Toilet["source"]) ?? "osm",
    has_washlet: (row.has_washlet as boolean | null) ?? null,
    has_diaper_table: (row.has_diaper_table as boolean | null) ?? null,
    is_universal: (row.is_universal as boolean | null) ?? null,
    review_count: Number(row.review_count ?? 0),
    avg_rating: row.avg_rating == null ? null : Number(row.avg_rating),
    dominant_access: (row.dominant_access as Toilet["dominant_access"]) ?? null,
    inferred_access: (row.inferred_access as Toilet["inferred_access"]) ?? null,
    opening_hours: (row.opening_hours as string | null) ?? null,
    not_a_toilet_count: Number(row.not_a_toilet_count ?? 0),
  };
}

export async function getToiletById(id: string): Promise<Toilet | null> {
  if (!isUuid(id)) return null;
  try {
    const supabase = getServerSupabasePublishable();
    const { data, error } = await supabase.rpc("toilet_by_id", { t_id: id });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return toToilet(row as Record<string, unknown>);
  } catch {
    return null;
  }
}

type Bbox = [number, number, number, number]; // [southLat, westLng, northLat, eastLng]

export async function getToiletsInRegion(bbox: Bbox, limit = 200): Promise<Toilet[]> {
  const [south, west, north, east] = bbox;
  try {
    const supabase = getServerSupabasePublishable();
    const { data, error } = await supabase.rpc("toilets_in_region", {
      min_lng: west,
      min_lat: south,
      max_lng: east,
      max_lat: north,
      result_limit: limit,
    });
    if (error || !Array.isArray(data)) return [];
    return data.map((r) => toToilet(r as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function getRegionCount(bbox: Bbox): Promise<number> {
  const [south, west, north, east] = bbox;
  try {
    const supabase = getServerSupabasePublishable();
    const { data, error } = await supabase.rpc("toilets_in_region_count", {
      min_lng: west,
      min_lat: south,
      max_lng: east,
      max_lat: north,
    });
    if (error || data == null) return 0;
    return Number(Array.isArray(data) ? data[0] : data) || 0;
  } catch {
    return 0;
  }
}

export async function getToiletCount(): Promise<number> {
  try {
    const supabase = getServerSupabasePublishable();
    const { data, error } = await supabase.rpc("toilet_count");
    if (error || data == null) return 0;
    return Number(Array.isArray(data) ? data[0] : data) || 0;
  } catch {
    return 0;
  }
}

// PostgREST(Supabase API)は 1 レスポンス最大 1000 行なので、RPC に p_limit を大きく渡しても
// 1000 行で切れる。よって 1000 行ずつ内部ページングして `limit` 行まで集める。
const PG_MAX_ROWS = 1000;

export async function getToiletIdsPage(
  offset: number,
  limit: number
): Promise<{ id: string; created_at: string | null }[]> {
  const out: { id: string; created_at: string | null }[] = [];
  try {
    const supabase = getServerSupabasePublishable();
    while (out.length < limit) {
      const batch = Math.min(PG_MAX_ROWS, limit - out.length);
      const { data, error } = await supabase.rpc("toilet_ids_page", {
        p_offset: offset + out.length,
        p_limit: batch,
      });
      if (error || !Array.isArray(data) || data.length === 0) break;
      for (const r of data) {
        out.push({
          id: String((r as Record<string, unknown>).id),
          created_at: ((r as Record<string, unknown>).created_at as string | null) ?? null,
        });
      }
      if (data.length < batch) break; // データを取り切った
    }
  } catch {
    // 取れた分だけ返す(部分 sitemap)
  }
  return out;
}

// 指定トイレ周辺の近隣トイレ(自身を除く、距離順)。
export async function getNearbyToilets(t: Toilet, n = 8): Promise<Toilet[]> {
  const d = 0.012; // ≒ 1.3km 四方
  const bbox: Bbox = [t.lat - d, t.lng - d, t.lat + d, t.lng + d];
  const rows = await getToiletsInRegion(bbox, 80);
  return rows
    .filter((x) => x.id !== t.id)
    .map((x) => ({ x, m: haversineMeters(t, x) }))
    .sort((a, b) => a.m - b.m)
    .slice(0, n)
    .map((e) => e.x);
}
