-- 006_seo_rpcs_fast.sql — sitemap 用 RPC の高速化(005 の toilet_ids_page / toilet_count を上書き)
-- 実行: Supabase ダッシュボード > SQL Editor で全文ペースト → Run(または supabase db push)。冪等。
--
-- 背景:
--  - toilet_ids_page は created_at 順にページングするが toilets.created_at にインデックスが無く
--    毎回 8 万行のフルソートが走る → `(created_at, id)` の複合インデックスを追加してインデックススキャンに。
--  - toilet_stats(reviews 集計ビュー)の join を外す。not_a_toilet>=5 のトイレが sitemap に残るが、
--    /toilet/[id] ページ側が not_a_toilet_count>=5 を notFound() するので Google からは自然に落ちる。
--  - toilet_count も同様に集計ビュー join を外して単純な count(*) に。
--  - 注: PostgREST(Supabase API)は 1 レスポンス最大 1000 行。アプリ側(getToiletIdsPage)が
--    1000 行ずつ内部ページングして必要件数を集めるので、ここでは p_limit の上限は気にしなくてよい。

create index if not exists toilets_created_at_idx on toilets (created_at, id);

create or replace function toilet_ids_page(p_offset int default 0, p_limit int default 1000)
returns table (id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.created_at
  from toilets t
  order by t.created_at asc, t.id asc
  limit p_limit offset p_offset;
$$;

create or replace function toilet_count()
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from toilets;
$$;

grant execute on function toilet_ids_page(int, int) to anon, authenticated;
grant execute on function toilet_count() to anon, authenticated;
