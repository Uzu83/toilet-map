-- 009_source_constraint_seo.sql — Phase 2: source 不変条件 + SEO 述語パリティ確認(Issue #2 / task 2.5)
-- 実行: Supabase ダッシュボード > SQL Editor で全文ペースト → Run。冪等。008 の後に適用する。
--
-- 目的:
--  (1) toilets.source を ('osm','user','inferred') に CHECK 制約で固定する。
--      user 投稿の昇格(008 submit_toilet)で未知の source 値が混入するのを防ぎ、
--      既存 OSM/inferred ピンの語彙を不変条件化する(AC4 補強)。
--  (2) SEO indexable 述語(007)が source='user' を正しく扱うことを確認する。
--      → **述語の変更は不要**。007 の canonical predicate:
--           INDEXABLE(t) := not_a_toilet_count<5 AND ( review_count>0 OR (source='osm' AND NAMED) )
--        の review_count>0 ブランチは source 非依存。よって:
--          - user 投稿 + レビュー1件 → review_count>0 → indexable(設計判断「user もレビュー1件で昇格」を満たす)
--          - user 投稿 + レビュー0   → review_count=0 かつ source≠'osm' → noindex(inferred と同じ品質ゲート)
--        TS 側 src/lib/toiletSeo.ts isToiletIndexable も review_count>0 を source 非依存で返すため
--        SQL-TS パリティは既存実装のまま成立する(TESTS-2.md N8/E15/R4/SQL1)。
--        redundant な `OR (source='user' ...)` を足すと二重述語になり保守性を下げるため追加しない。

-- (1) source CHECK 制約。既存行(osm/inferred)は満たすため安全。冪等化のため drop→add。
alter table toilets drop constraint if exists toilets_source_check;
alter table toilets add constraint toilets_source_check
  check (source in ('osm', 'user', 'inferred'));
