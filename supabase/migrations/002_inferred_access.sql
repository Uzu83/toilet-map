-- 推定アクセスレベル + 営業時間
-- inferred_access: source='inferred' のトイレ(駅・モール・公共施設)に既定色。レビューが集まれば dominant_access 優先
-- opening_hours: OSM 形式(例: "Mo-Su 09:00-21:00", "24/7"), フロントでパースして営業時間外グレー化

alter table toilets
  add column if not exists inferred_access access_level,
  add column if not exists opening_hours text;

-- toilets_in_bbox RPC を更新: inferred_access + opening_hours を返却
-- 戻り値型を変えるため、CREATE OR REPLACE では弾かれる。先に DROP する。
drop function if exists toilets_in_bbox(double precision, double precision, double precision, double precision, int);

create or replace function toilets_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  result_limit int default 500
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
  opening_hours text
)
language sql
stable
security definer
set search_path = public
as $$
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
    t.opening_hours
  from toilets t
  left join toilet_stats s on s.id = t.id
  where t.location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
  order by t.id
  limit result_limit;
$$;

grant execute on function toilets_in_bbox(double precision, double precision, double precision, double precision, int) to anon, authenticated;
