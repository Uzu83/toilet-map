-- 005_seo_rpcs.sql — プログラマティック SEO ページ用 RPC
-- (個別トイレページ /toilet/[id]、エリアランディング /area/[region]、分割 sitemap)
-- 実行: Supabase ダッシュボード > SQL Editor で全文ペースト → Run(または supabase db push)
-- 冪等: create or replace のみ。既存マイグレーションは書き換えない方針。
--
-- 既存の toilet_stats ビュー(003 で更新済み)が review_count / avg_rating /
-- dominant_access / not_a_toilet_count を返す前提。toilets_in_bbox と同じく
-- not_a_toilet_count >= 5 の施設は除外する(self-correcting)。

-- (1) sitemap 用の軽量 id ページャ(10k+ 行のフル取得を避ける)
create or replace function toilet_ids_page(p_offset int default 0, p_limit int default 50000)
returns table (id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.created_at
  from toilets t
  left join toilet_stats s on s.id = t.id
  where coalesce(s.not_a_toilet_count, 0) < 5
  order by t.created_at asc, t.id asc
  limit p_limit offset p_offset;
$$;

-- (2) sitemap のチャンク数計算用
create or replace function toilet_count()
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from toilets t
  left join toilet_stats s on s.id = t.id
  where coalesce(s.not_a_toilet_count, 0) < 5;
$$;

-- (3) bbox(エリア境界)内のトイレ + 集計。toilets_in_bbox / toilet_by_id と同じ列形なので
--     フロントの Toilet 型を再利用できる。ランディングページ向けに limit を大きめに、
--     レビュー有り → 件数多い順で並べて「中身のあるページ」になるようにする。
create or replace function toilets_in_region(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  result_limit int default 2000
)
returns table (
  id uuid,
  name text,
  lat double precision,
  lng double precision,
  source text,
  has_washlet boolean,
  has_diaper_table boolean,
  is_universal boolean,
  review_count bigint,
  avg_rating numeric,
  dominant_access access_level,
  inferred_access access_level,
  opening_hours text,
  not_a_toilet_count bigint
)
language sql stable security definer set search_path = public as $$
  select
    t.id,
    t.name,
    st_y(t.location::geometry) as lat,
    st_x(t.location::geometry) as lng,
    t.source,
    t.has_washlet,
    t.has_diaper_table,
    t.is_universal,
    coalesce(s.review_count, 0) as review_count,
    s.avg_rating,
    s.dominant_access,
    t.inferred_access,
    t.opening_hours,
    coalesce(s.not_a_toilet_count, 0) as not_a_toilet_count
  from toilets t
  left join toilet_stats s on s.id = t.id
  where t.location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    and coalesce(s.not_a_toilet_count, 0) < 5
  order by coalesce(s.review_count, 0) desc, coalesce(s.avg_rating, 0) desc, t.id
  limit result_limit;
$$;

-- (4) エリアページの「{N}件」表示用
create or replace function toilets_in_region_count(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision
)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from toilets t
  left join toilet_stats s on s.id = t.id
  where t.location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    and coalesce(s.not_a_toilet_count, 0) < 5;
$$;

grant execute on function toilet_ids_page(int, int) to anon, authenticated;
grant execute on function toilet_count() to anon, authenticated;
grant execute on function toilets_in_region(double precision, double precision, double precision, double precision, int) to anon, authenticated;
grant execute on function toilets_in_region_count(double precision, double precision, double precision, double precision) to anon, authenticated;
