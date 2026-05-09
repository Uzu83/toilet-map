-- 「ここトイレない/使えない」報告
-- inferred ピン(駅・モール等)で「実際にはトイレなかった」のクラウドソース訂正用。
-- 一定数を超えたら表示を抑制する(self-correcting)。

alter table reviews
  add column if not exists not_a_toilet boolean not null default false;

create index if not exists reviews_not_a_toilet_idx on reviews(toilet_id) where not_a_toilet;

-- toilet_stats を「報告除外」「報告カウント」両方返すよう更新
create or replace view toilet_stats as
select
  t.id,
  count(r.id) filter (where not r.not_a_toilet) as review_count,
  avg(r.rating) filter (where not r.not_a_toilet)::numeric(2,1) as avg_rating,
  mode() within group (order by r.access_level)
    filter (where not r.not_a_toilet) as dominant_access,
  count(r.id) filter (where r.not_a_toilet) as not_a_toilet_count
from toilets t
left join reviews r on r.toilet_id = t.id
group by t.id;

-- toilets_in_bbox に not_a_toilet_count を追加
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
  where t.location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    -- 5件以上「ここトイレない」報告された施設は表示しない(self-correcting)
    and coalesce(s.not_a_toilet_count, 0) < 5
  order by t.id
  limit result_limit;
$$;

grant execute on function toilets_in_bbox(double precision, double precision, double precision, double precision, int) to anon, authenticated;
