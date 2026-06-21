-- 017_close_reviews_anon_exposure.sql — reviews の anon/authenticated 直 SELECT を閉じる(PII=ip_hash 露出の修正)
--
-- ⚠️ デプロイ前手動 apply。本番(ijsftemvtnfvqemjbrxc)には適用済み(2026-06-21、Codex 厳格議論 + オーナー承認後)。
--    本番検証済: anon/authenticated の reviews SELECT=false、reviews の policy 0 件。anon は toilet_by_id RPC 経由で
--    レビュー集計(review_count/avg_rating/dominant_access)を引き続き取得できる(ip_hash は構造的に出ない)。
--
-- 背景(本番 B1 RLS 監査 + Codex 厳格議論で確定 = High/P1):
--   001 の RLS policy「public read reviews」(SELECT USING(true) for public)+ anon の既定テーブル grant により、
--   公開 anon キーで `/rest/v1/reviews?select=ip_hash` を叩けば全 reviews の ip_hash を取得できた
--   (本番で `SET LOCAL ROLE anon; select ip_hash from reviews` により 8 行・実 hash を読めることを確認)。
--   ip_hash は `sha256(salt:ip)[:32]`(salt=IP_HASH_SALT ?? 公開既定値 "toilet-map"、src/lib/rateLimit.ts:17-19)で、
--   salt が既知なら IPv4 全空間(約43億)のブルートフォースで実 IP に逆引きされうる pseudonymous PII。
--
-- なぜ閉じても安全か:
--   app の reviews 読み取りは全てサーバー側(secret key・ip_hash 明示除外)+ 公開表示は toilet_by_id RPC 経由。
--   toilet_by_id(004)は SECURITY DEFINER で reviews を直接読まず toilets + toilet_stats(集計)を読むため、
--   anon の reviews テーブル grant とは独立に動く。grep + 本番 anon E2E で「anon が reviews を直読みする経路は無い」を確認。
--
-- Codex 異モデルの厳格議論で合意した方針:
--   A(anon/authenticated の reviews SELECT を revoke)+ C(public-read policy を drop)が最善。
--   B(ip_hash 列だけ revoke)は **table 単位 SELECT grant の下では列 revoke が効かない**ため不採用
--   (列制限したいなら table SELECT を剥がして必要列だけ列 GRANT し直す必要がある=過剰)。
--
-- ⚠️ P2 follow-up(本 017 ではやらない・別途オーナー判断): IP_HASH_SALT を HMAC(secret,ip)+fail-closed 化、
--    001 の `alter default privileges ... grant select on tables to anon` の棚卸し(将来 PII テーブル追加時の再発防止)。
--    ★ 後任 AI へ: 公開テーブルに PII 列を足すときは「RLS 有効」だけでなく、anon の列/テーブル grant も必ず確認すること。

-- A: anon/authenticated から reviews のテーブル SELECT を剥がす(列単位 revoke は table grant 下で無効なため table 単位)。
revoke select on reviews from anon, authenticated;

-- C: 公開 read policy を drop(anon SELECT の根を断つ。将来 grant を足しても policy が無ければ非 bypass ロールは読めない)。
drop policy if exists "public read reviews" on reviews;
