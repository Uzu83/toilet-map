// サーバー専用: SEO ページ(/toilet/[id]、/area/[region]、sitemap)向けの Supabase 読み取りヘルパ。
// すべて publishable key の読み取り(RLS で select は公開)。失敗時は null / [] / 0 にフォールバックする
// ので、Supabase 障害やビルド時の env 欠落でもページ・ビルドが落ちない。

import { cache } from "react";
import { getServerSupabasePublishable } from "@/lib/supabase/server";
import type { Toilet } from "@/types/toilet";
import { isUuid } from "@/lib/uuid";
import { haversineMeters } from "@/lib/geo";
import { isToiletIndexable } from "@/lib/toiletSeo";

// RPC が返す行 → Toilet 型(boolean/null をそのまま受ける)。
// WHY export: api/toilets/[id]/route.ts が 200 レスポンスの shape 正規化に使う。
//   getToiletById() は RPC エラーを null に潰すため、route の「RPC error → 500」パスが消えてしまう。
//   そこで route は RPC を直接呼び、成功時の行をこの関数で Toilet 型に変換するだけにする(PR2 #13)。
export function toToilet(row: Record<string, unknown>): Toilet {
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

// WHY cache() でラップするか:
//   /toilet/[id]/page.tsx は generateMetadata と page の両方が getToiletById を呼ぶ。
//   Supabase-js は fetch ではなく WebSocket/HTTP POST を使うため、Next の fetch-memoization は
//   適用されない。cache() は React の per-request memo(サーバーリクエスト境界ごとにキャッシュが
//   破棄される)なので、同一リクエスト内での二重 DB ラウンドトリップを 1 回にできる。
//   出力は変わらず、DB 負荷と応答時間が減る効果のみ。
export const getToiletById = cache(async function getToiletById(id: string): Promise<Toilet | null> {
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
});

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

// getToiletCount(toilet_count RPC)は削除済み。
// 呼び出し元が存在しなかった(sitemap は *Indexable* バリアントのみを使う)ため dead code と判定。
// 件数が必要になったら getIndexableToiletCount を参考に toilet_count RPC で再実装すること。

// indexable サブセット(canonical predicate, 設計書 §5.1)の件数。
// sitemap のチャンク数算出(sitemapChunkCount)が依存する。失敗時は 0 フォールバック。
export async function getIndexableToiletCount(): Promise<number> {
  try {
    const supabase = getServerSupabasePublishable();
    const { data, error } = await supabase.rpc("toilet_indexable_count");
    if (error || data == null) return 0;
    return Number(Array.isArray(data) ? data[0] : data) || 0;
  } catch {
    return 0;
  }
}

// getToiletIdsPage(toilet_ids_page RPC)は削除済み。
// sitemap は getIndexableToiletIdsPage(toilet_ids_indexable_page)のみを使うため dead code と判定。
// 非 indexable を含む全件ページングが必要になったら toilet_ids_page RPC で再実装すること。

// PostgREST(Supabase API)は 1 レスポンス最大 1000 行なので、RPC に p_limit を大きく渡しても
// 1000 行で切れる。よって 1000 行ずつ内部ページングして `limit` 行まで集める。
const PG_MAX_ROWS = 1000;

// indexable サブセット(canonical predicate, 設計書 §5.1)の id ページ。sitemap の id>=1 チャンクが使う。
// PostgREST の 1000 行上限を内部ページングで越える(RPC 名のみが特徴、ページング機構は上記の PG_MAX_ROWS 利用と同じ)。
export async function getIndexableToiletIdsPage(
  offset: number,
  limit: number
): Promise<{ id: string; created_at: string | null }[]> {
  const out: { id: string; created_at: string | null }[] = [];
  try {
    const supabase = getServerSupabasePublishable();
    while (out.length < limit) {
      const batch = Math.min(PG_MAX_ROWS, limit - out.length);
      const { data, error } = await supabase.rpc("toilet_ids_indexable_page", {
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

// #30 — sitemap チャンク 0 のエリアフィルタ用プロキシ。
//
// WHY 専用 helper にするか:
//   sitemap と area/[region]/page.tsx の両方が「このエリアに indexable トイレが 1 件でもあるか」
//   を判定する必要がある(#29/#30 同一述語 = 単一ソース)。
//   sitemap は直接 Page コンポーネントを呼べないため helper として切り出す。
//
// KNOWN FALSE-NEGATIVE(#29 と同じ。意図的に受け入れる):
//   toilets_in_region は review_count desc でソート(005:77)。zero-review named-OSM は
//   180 件超のエリアでウィンドウ外に落ちる可能性があり、その場合このエリアは false を返す。
//   index-reducing(= noindex 方向への変化のみ)なので ISR Write 予算に安全。
//   /toilet/[id] の個別ページは getIndexableToiletIdsPage 経由で sitemap に残る。
export async function areaHasIndexableToilets(
  bbox: Bbox
): Promise<boolean> {
  const toilets = await getToiletsInRegion(bbox, 180);
  return toilets.some(isToiletIndexable);
}

// 指定トイレ周辺の近隣トイレ(自身を除く、距離順)。
//
// [I8] WHY d = 0.012 か(≒ 1.3km 四方):
//   lat/lng の 0.012 度 ≈ 赤道で約 1.34 km、日本では約 1.06 km。
//   半径 1 〜 1.3 km 圏は「徒歩 10〜15 分以内に行ける近隣」の実用的な目安。
//   広すぎる(例 0.05)と「近隣」の定義を超え SEO ページの関連リンクが広域化しすぎる。
//   狭すぎる(例 0.003)と都心部で 0 件になりやすく Near Me 動線が途切れる。
//   0.012 は福岡市中心部の実データで「0〜8 件程度が安定して返る」と検証して採用。
//
// WHY limit = 80 で over-fetch するか:
//   PostgREST の 1000 行上限はここでは問題にならないが、bbox に入る件数は地域密度次第で
//   大きく変わる(福岡市中心 = 密、山間部 = 0 件)。
//   n = 8 件だけ取ろうとしても、DB 側では「自身を除く」「距離ソート」ができないため、
//   一旦 bbox 全件 (≤80) を取ってアプリ層でフィルタ・距離ソートする。
//   limit = 80 は「半径 1.3km 圏にトイレが 80 件以上密集する地域は国内ほぼ存在しない」という
//   経験則的な上限。超えた場合は距離 80 位以降が切れるだけで near-by 候補の品質には影響しない。
export async function getNearbyToilets(t: Toilet, n = 8): Promise<Toilet[]> {
  const d = 0.012; // ≒ 1.3km 四方(WHY: 上記コメント参照)
  const bbox: Bbox = [t.lat - d, t.lng - d, t.lat + d, t.lng + d];
  const rows = await getToiletsInRegion(bbox, 80);
  return rows
    .filter((x) => x.id !== t.id)
    .map((x) => ({ x, m: haversineMeters(t, x) }))
    .sort((a, b) => a.m - b.m)
    .slice(0, n)
    .map((e) => e.x);
}
