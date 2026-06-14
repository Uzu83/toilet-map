-- 007_seo_indexable.sql — sitemap の indexable 部分集合だけを列挙する RPC(Issue #1)
-- 実行: Supabase ダッシュボード > SQL Editor で全文ペースト → Run(または supabase db push)。冪等。
-- ⚠️ デプロイ前に手動 apply が必要。未適用のまま deploy すると未定義 RPC → アプリ側 0 fallback で
--    sitemap が 1 チャンク固定になり退行する(generateSitemaps はビルド時確定、自動回復しない)。
--    適用順序は設計書 §5.1 / PROGRESS 5.1: 007 apply → 疎通(count==実測 N) → build → deploy → smoke。
--
-- 新ファイル方針: 既存 001-006 は書き換えない。indexable ゲートは新 RPC として 007 に追加する。
--
-- 背景:
--  - 起点コミット 83e63ee で indexable ゲート = review_count>0 にしたところ鶏卵問題(検索流入なし→
--    レビュー付かない→永遠に noindex)。Issue #1 で named OSM を品質シグナルに追加し母集団を広げる。
--  - 006 は速度のため toilet_ids_page / toilet_count から toilet_stats join を「外した」。
--    本 RPC は WHERE 述語に review_count / not_a_toilet_count を含めるため、toilet_stats join を
--    「再導入」する(003 の集計ビュー由来。review_count / not_a_toilet_count を coalesce で参照)。
--  - 既存 toilet_ids_page / toilet_count(006)は温存。sitemap 経路だけ本 RPC に差し替える。
--
-- canonical predicate(設計書 §5.1 — SQL/TS はこの定義を実装するだけ):
--   INDEXABLE(t) := coalesce(s.not_a_toilet_count,0) < 5
--                AND ( coalesce(s.review_count,0) > 0
--                      OR ( t.source = 'osm' AND NAMED(t) ) )
--   NAMED(t)     := (t.name IS NOT NULL AND t.name ~ '[^[:space:]]')
-- TS 側(src/lib/toiletSeo.ts isToiletIndexable)と同一の真理値表(§5.2)に一致させること。
-- NAMED は POSIX [:space:] クラスで判定する。SQL の btrim(引数なし)は ASCII 半角スペースのみ除去で
-- TS の trim()(タブ/改行/全角スペース等の Unicode 空白も除去)とズレるため、btrim ではなく
-- name ~ '[^[:space:]]'(「空白以外の文字が 1 つ以上ある」)を canonical とする(§5.1 注記 / Step8-P1)。

-- (1) sitemap 用 indexable id ページャ。006 の列形 (id uuid, created_at timestamptz) を踏襲。
create or replace function toilet_ids_indexable_page(p_offset int default 0, p_limit int default 1000)
returns table (id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.created_at
  from toilets t
  left join toilet_stats s on s.id = t.id
  where coalesce(s.not_a_toilet_count, 0) < 5
    and (
      coalesce(s.review_count, 0) > 0
      or (t.source = 'osm' and t.name is not null and t.name ~ '[^[:space:]]')
    )
  order by t.created_at asc, t.id asc
  limit p_limit offset p_offset;
$$;

-- (2) sitemap のチャンク数計算用。同 join + canonical WHERE で件数を返す。
create or replace function toilet_indexable_count()
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from toilets t
  left join toilet_stats s on s.id = t.id
  where coalesce(s.not_a_toilet_count, 0) < 5
    and (
      coalesce(s.review_count, 0) > 0
      or (t.source = 'osm' and t.name is not null and t.name ~ '[^[:space:]]')
    );
$$;

-- 部分インデックス: named-OSM branch(canonical の OR 第二項)用。
-- 述語は §5.1 の NAMED 正規化に厳密一致させる(name ~ '[^[:space:]]')。
-- 注意: この index は named-OSM 経路の絞り込み + (created_at,id) 順ページングだけを高速化する。
--       OR 全体、特に review_count>0 経路(toilet_stats join 依存)の高速化は保証しない。
--       実時間が問題なら 2.1 を union 分割(review>0 経路 / named-osm 経路)に変える fallback を検討(§4.3 R5)。
create index if not exists toilets_named_osm_idx
  on toilets (created_at, id)
  where source = 'osm' and name ~ '[^[:space:]]';

grant execute on function toilet_ids_indexable_page(int, int) to anon, authenticated;
grant execute on function toilet_indexable_count() to anon, authenticated;
