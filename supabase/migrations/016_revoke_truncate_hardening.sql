-- 016_revoke_truncate_hardening.sql — append-only 監査/台帳 + toilets の TRUNCATE default-grant 穴を塞ぐ
--
-- ⚠️ デプロイ前手動 apply(main 自動デプロイ OFF)。本番(ijsftemvtnfvqemjbrxc)には適用済み(2026-06-21)。
--    has_table_privilege 検証済: admin_edits/submission_confirmations は truncate/delete/update=false(insert/select のみ)、
--    toilets は truncate=false(update は seed upsert 用に維持、delete は 012 で既に false)。
--
-- 背景(015 と同根の Supabase default-privileges 罠):
--   001 の `alter default privileges in schema public grant all on tables to service_role` が、後から作る全テーブルに
--   service_role 用 ALL(SELECT/INSERT/UPDATE/DELETE/TRUNCATE/...)を既定付与する。よって明示 REVOKE しない限り
--   service_role(= admin API・seed が持つ secret 鍵)は全テーブルを DELETE/TRUNCATE できる。
--
--   ★ append-only の落とし穴: admin_edits(011)/ submission_confirmations(008)は「行 trigger で UPDATE/DELETE を
--     拒否」して改ざん不能の監査/台帳を実現している。だが PostgreSQL の行/文 trigger は TRUNCATE イベントを
--     捕捉しない(TRUNCATE を止めるには別途 BEFORE TRUNCATE trigger が要る)。結果、trigger をすり抜けて
--     service_role が監査ログ/台帳を全件 TRUNCATE で消去できてしまう = 「追記専用で消えない」不変条件の穴。
--   ★ toilets: 012 が「seed は upsert のみ・行消失を防ぐ」ため DELETE を revoke したが、TRUNCATE は残っていた
--     (= 地図データ全件消去経路)。012 の保護意図を TRUNCATE まで広げて完成させる。
--
--   この穴は Codex 異モデルレビュー(015 の検証依頼)で admin_edits/submission_confirmations が指摘され、
--   本番 has_table_privilege 検証で toilets も追加発見、オーナー承認の上で本 016 を適用した。
--
-- ★ 後任 AI への鉄則(再掲): Supabase で「grant しない=権限なし」ではない。append-only/最小権限を意図する
--    テーブルは、行 trigger だけでなく grant でも UPDATE/DELETE/TRUNCATE を明示 REVOKE して二重に締めること。
--
-- 機能影響なし: admin_edits/submission_confirmations はコード経路が service_role で INSERT(append)+ SELECT のみ
--   (admin_apply_edit の監査追記 / submit_toilet の confirm 追記 / Dashboard 読取)。delete/update/truncate は未使用。
--   toilets は seed-osm の upsert が UPDATE を使う(維持)。truncate はどの経路も使わない。

-- admin_edits(監査ログ・append-only): trigger(UPDATE/DELETE 拒否)と grant を一致させ、全消去 TRUNCATE も封じる。
revoke update, delete, truncate on admin_edits from service_role;

-- submission_confirmations(distinct-ip confirm 台帳・append-only): 同上。
revoke update, delete, truncate on submission_confirmations from service_role;

-- toilets(地図データ): 012 の DELETE revoke を完成(TRUNCATE で全件消去させない)。
--   UPDATE は seed-osm の upsert(INSERT...ON CONFLICT DO UPDATE)が依存するので残す。DELETE は 012 で revoke 済。
revoke truncate on toilets from service_role;
