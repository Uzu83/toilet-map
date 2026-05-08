-- Toilet Map (ピットイン) 初期スキーマ
-- 実行: Supabase ダッシュボード > SQL Editor で全文ペースト → Run
-- 冪等性: 何度流しても壊れないように IF NOT EXISTS で書く

create extension if not exists postgis;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'access_level') then
    create type access_level as enum ('open', 'ask', 'permission');
    -- open=青(訪るだけで使用可) / ask=黄(一声かけ要) / permission=赤(許可必要)
  end if;
end $$;

create table if not exists toilets (
  id uuid primary key default gen_random_uuid(),
  osm_id bigint unique,
  name text,
  location geography(point, 4326) not null,
  address text,
  has_washlet boolean,
  has_paper boolean,
  has_soap boolean,
  has_diaper_table boolean,
  is_universal boolean,
  source text not null default 'osm',
  created_at timestamptz not null default now()
);

create index if not exists toilets_location_idx on toilets using gist(location);
create index if not exists toilets_source_idx on toilets(source);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  toilet_id uuid not null references toilets(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  access_level access_level not null,
  has_washlet boolean,
  comment text check (length(coalesce(comment, '')) <= 500),
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists reviews_toilet_idx on reviews(toilet_id);
create index if not exists reviews_iphash_toilet_idx on reviews(ip_hash, toilet_id, created_at desc);

create or replace view toilet_stats as
select
  t.id,
  count(r.id) as review_count,
  avg(r.rating)::numeric(2,1) as avg_rating,
  mode() within group (order by r.access_level) as dominant_access
from toilets t
left join reviews r on r.toilet_id = t.id
group by t.id;

-- bbox 内のトイレ + 集計取得用 RPC
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
  dominant_access access_level
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
    s.dominant_access
  from toilets t
  left join toilet_stats s on s.id = t.id
  where t.location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
  order by t.id
  limit result_limit;
$$;

-- RLS: 読み取りは全員に開放、書き込みは API ルート(service_role)経由のみ
alter table toilets enable row level security;
alter table reviews enable row level security;

drop policy if exists "public read toilets" on toilets;
create policy "public read toilets" on toilets for select using (true);

drop policy if exists "public read reviews" on reviews;
create policy "public read reviews" on reviews for select using (true);

-- bbox RPC は anon でも実行可
grant execute on function toilets_in_bbox(double precision, double precision, double precision, double precision, int) to anon, authenticated;
