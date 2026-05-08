-- 単一トイレ取得用 RPC(deep linking 用)
-- toilets_in_bbox と同じ列を返すため、フロント側の Toilet 型で共通利用できる

create or replace function toilet_by_id(t_id uuid)
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
    t.opening_hours,
    coalesce(s.not_a_toilet_count, 0) as not_a_toilet_count
  from toilets t
  left join toilet_stats s on s.id = t.id
  where t.id = t_id;
$$;

grant execute on function toilet_by_id(uuid) to anon, authenticated;
