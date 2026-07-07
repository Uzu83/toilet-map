-- 018_security_advisor_hardening.sql
-- ============================================================================
-- 背景(WHY): 2026-07-06 の Supabase Security Advisor メールで CRITICAL
-- 「rls_disabled_in_public」が通知された。get_advisors で全 lint を棚卸しした結果:
--
--   [ERROR] rls_disabled_in_public: public.spatial_ref_sys (PostGIS カタログ)
--           → アプリの 8 テーブルは全て RLS 有効。CRITICAL の正体はこれだけ。
--             ただし ACL 実査で anon/authenticated が arwdDxtm(フル権限)を保持
--             = anon key で EPSG カタログを DELETE/UPDATE できる実害あり
--             (SRID 4326 行が消えると geography 演算が壊れ地図 API が全滅する)。
--             所有者は supabase_admin で postgres は非メンバー・非 superuser のため
--             修正できない可能性が高い → 本 migration では「ベストエフォート試行 +
--             結果ログ」に留め、失敗時は Supabase サポートへの依頼で解決する。
--   [ERROR] security_definer_view: public.toilet_stats
--           → 017 で reviews の anon SELECT を閉じたが、definer ビュー経由だと
--             作成者(postgres)権限で reviews を読める抜け道が残る。invoker 化する。
--   [WARN]  function_search_path_mutable: forbid_ledger_mutation /
--           forbid_admin_edits_mutation / jsonb_to_bool / nullif_jsonb_text
--           → search_path 差し替え攻撃対策。他関数(submit_toilet 等)は設定済み。
--   [WARN]  anon_security_definer_function_executable: 公開読み取り RPC 群
--           (toilets_in_bbox / toilet_by_id / pending_submissions_in_bbox 等)
--           → これらは「anon 公開の読み取り API」として意図的(維持)。
--             例外は nearby_toilet: src から直接呼ばれず submit_toilet 内部専用
--             なので anon から閉じる。rls_auto_enable(event trigger 関数)も閉じる。
--   [INFO]  rls_enabled_no_policy: 5 テーブル → 「RLS 有効 + ポリシー無し =
--           非 bypass ロール全拒否」は設計意図(008/011/014 のコメント参照)。放置。
--   [WARN]  extension_in_public: postgis → 移動には drop cascade が必要で
--           geometry 列(toilets.location)を道連れにするため不可。受容する残存リスク。
--
-- 追加発見(advisor 外・ACL 実査): Supabase のデフォルト権限により、全アプリテーブルで
-- anon/authenticated に TRUNCATE(D)/TRIGGER(t)/REFERENCES(x)/MAINTAIN(m) が残存。
-- TRUNCATE は RLS の対象外(行単位チェックが走らない)なので、RLS deny-all でも
-- grant が残っている限り理論上の穴になる。PostgREST は TRUNCATE 動詞を持たないため
-- 今日時点で直接悪用経路は無いが、016(service_role TRUNCATE REVOKE)と同じ思想で
-- 明示 REVOKE で締める。memory/reference_supabase_grants_rls の教訓と同根。
--
-- 冪等性: 全て REVOKE / ALTER SET / DO ブロック内 try で二重適用しても安全。
--
-- Codex ゲート1 合意事項(2026-07-08、異モデルレビューで確定した修正):
--   a. spatial_ref_sys は「policy 作成 → 成功時のみ RLS 有効化」の順に変更。
--      RLS 未有効のテーブルに policy だけあっても不活性で無害なため、
--      「RLS 有効 + policy 無し(= PostGIS 参照が全ロールで死ぬ)」という
--      危険な中間状態が構造的に発生しない(Codex 指摘 #1 への中間案)。
--   b. nearby_toilet の revoke は PUBLIC も含める(Codex 指摘 #4)。関数は既定で
--      PUBLIC EXECUTE を持つため anon/authenticated だけ revoke しても実効無効。
--   c. rls_auto_enable は存在ガード付き DO ブロックに(fresh/staging 環境で
--      関数が無いと migration が落ちるため。Codex 指摘 #6)。
--   d. live smoke に toilet_stats 依存の SEO RPC 群(toilet_ids_page /
--      toilet_count / toilets_in_region_count / toilet_ids_indexable_page /
--      toilet_indexable_count)と anon での nearby_toilet 拒否確認を追加。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (1) spatial_ref_sys — ベストエフォート試行
--
-- WHY DO ブロック: 所有者が supabase_admin のため、postgres では
--   ALTER TABLE ... ENABLE RLS が "must be owner" で失敗する可能性が高い。
--   migration 全体を失敗させないため例外を握って NOTICE でログする。
--   REVOKE も「grantor でないロールの REVOKE は静かに no-op」という Postgres 仕様
--   なので、適用後に必ず ACL を実査して効果を確認すること(下の検証クエリ)。
--   両方効かなかった場合の残存リスク: anon key での EPSG カタログ改竄(可用性攻撃)。
--   → Supabase サポートに「spatial_ref_sys の anon/authenticated 書き込み grant を
--     REVOKE してほしい」と依頼するのが正攻法(メール自体がサポート連絡を案内している)。
-- ----------------------------------------------------------------------------
do $$
declare
  v_policy_ok boolean := false;
begin
  -- 1a. まず SELECT 全開放ポリシーを作る(RLS 有効化より「先」— Codex ゲート1 合意 a)。
  --     WHY この順序: RLS 未有効のテーブルに policy だけ存在しても不活性で無害。
  --     逆順(RLS 先行)だと「RLS 有効 + policy 作成失敗」の中間状態で
  --     spatial_ref_sys が全ロールから不可視になり、geography 演算(ST_DWithin 等は
  --     呼び出しロール権限で spatial_ref_sys を参照)が壊れて地図 API が全滅しうる。
  --     policy が確実に存在する場合のみ 1b で RLS を有効化する。
  begin
    execute 'create policy "public read spatial_ref_sys" on public.spatial_ref_sys for select using (true)';
    v_policy_ok := true;
    raise notice '018: spatial_ref_sys public read policy created';
  exception when duplicate_object then
    v_policy_ok := true; -- 冪等: 既に存在 = 前提は満たされている
    raise notice '018: spatial_ref_sys public read policy already exists';
  when others then
    raise notice '018: spatial_ref_sys policy creation failed (expected if not owner): %', sqlerrm;
  end;

  -- 1b. policy が存在する場合のみ RLS 有効化(成功すれば書き込みは非 bypass 全ロールで
  --     遮断され、SELECT は 1a の policy で全開放のまま = 塞ぐのは書き込みだけ)。
  --     owner=supabase_admin(superuser)は RLS bypass なので PostGIS 内部保守も影響なし。
  if v_policy_ok then
    begin
      execute 'alter table public.spatial_ref_sys enable row level security';
      raise notice '018: spatial_ref_sys RLS enabled';
    exception when others then
      raise notice '018: spatial_ref_sys RLS enable failed (expected if not owner): %', sqlerrm;
    end;
  else
    raise notice '018: spatial_ref_sys RLS enable skipped (no policy — avoid lockout state)';
  end if;

  -- 1c. 書き込み grant の REVOKE も試す(grantor=supabase_admin なので
  --     no-op の可能性が高いが、環境によっては効くため試行だけする)
  begin
    execute 'revoke insert, update, delete, truncate on public.spatial_ref_sys from anon, authenticated';
    raise notice '018: spatial_ref_sys revoke issued (verify ACL — may be a silent no-op)';
  exception when others then
    raise notice '018: spatial_ref_sys revoke failed: %', sqlerrm;
  end;
end $$;

-- ----------------------------------------------------------------------------
-- (2) toilet_stats ビューを SECURITY INVOKER 化 + anon/authenticated grant 撤去
--
-- WHY: definer ビュー(PG デフォルト)は「ビュー作成者(postgres)の権限」で下層を
--   読むため、017 で reviews の anon SELECT を REVOKE しても、anon が
--   /rest/v1/toilet_stats を直接叩けば reviews 集計を読めてしまう(抜け道)。
--   invoker 化すると下層 reviews への権限チェックが呼び出しロールで走る。
-- 影響範囲の確認済み事実(2026-07-08 実査 + Codex ゲート1 で参照元を全数確認):
--   - src/ に .from("toilet_stats") の直接利用はゼロ(grep 済)。
--   - このビューを参照する RPC は全部で 9 つ: toilets_in_bbox(003) /
--     toilet_by_id(004) / toilet_ids_page・toilet_count・toilets_in_region・
--     toilets_in_region_count(005) / toilet_ids_indexable_page・
--     toilet_indexable_count(007) / nearby_toilet(008)。
--     全て SECURITY DEFINER で owner=postgres → invoker 化後もビュー内部の
--     実行ロールは postgres のままなので既存 API は壊れない(9 つ全て検証必須、下記)。
--   - 集計値(review_count/avg_rating)自体は公開情報であり、公開経路は RPC に一本化する。
-- ----------------------------------------------------------------------------
alter view public.toilet_stats set (security_invoker = on);
revoke all on public.toilet_stats from anon, authenticated;

-- ----------------------------------------------------------------------------
-- (3) search_path 未固定関数の固定
--
-- WHY: search_path 差し替えによる同名オブジェクト乗っ取り対策(advisor WARN)。
--   既存の他関数(submit_toilet / admin_apply_edit 等)は search_path=public 固定済み
--   なので、同じ規約(= public)に揃える。空文字('')の方が理論上は堅いが、
--   このプロジェクトの public スキーマは anon に CREATE 権限が無く、
--   既存規約との一貫性を優先する(混在すると後任が「どちらが正か」で迷う)。
--   後任 AI へ(Codex ゲート1 合意): この 4 関数は例外 raise / jsonb 組み込み操作
--   のみで search_path=public のリスクは低いが、「security definer の理想形」
--   としては search_path='' + 完全修飾の方が堅い。今後、高権限の definer 関数を
--   新設する場合は '' or 'public, pg_temp' + 完全修飾を検討すること。
-- ----------------------------------------------------------------------------
alter function public.forbid_ledger_mutation() set search_path = public;
alter function public.forbid_admin_edits_mutation() set search_path = public;
alter function public.jsonb_to_bool(jsonb, text) set search_path = public;
alter function public.nullif_jsonb_text(jsonb, text) set search_path = public;

-- ----------------------------------------------------------------------------
-- (4) rls_auto_enable(event trigger 関数)の EXECUTE を閉じる
--
-- WHY: event trigger 関数は RPC として直接呼べない(呼ぶとエラー)ため実害は無いが、
--   デフォルトで PUBLIC に EXECUTE が付いており advisor WARN の元。最小権限で閉じる。
--   ensure_rls event trigger 自体は「新規 public テーブルの RLS 自動有効化」の
--   安全網として有用なので削除しない(この関数と trigger は migration 管理外で
--   作成されたもの。owner=postgres)。
--   WHY 存在ガード(Codex ゲート1 合意 c): migration 管理外の関数なので、
--   fresh/staging 環境には存在しない可能性がある。hard revoke だとそこで
--   migration 全体が落ちるため、存在する場合のみ revoke する。
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
    raise notice '018: rls_auto_enable() execute revoked from public/anon/authenticated';
  else
    raise notice '018: rls_auto_enable() not found — skipped (fresh env?)';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- (5) アプリテーブルの anon/authenticated 残存 grant 掃除
--
-- WHY: Supabase のデフォルト権限は新規テーブルに anon/authenticated へ
--   ほぼフル grant(TRUNCATE/TRIGGER/REFERENCES/MAINTAIN 含む)を付ける。
--   RLS deny-all(ポリシー無し)でも TRUNCATE は RLS 対象外なので grant 残存は
--   多層防御の欠け。017(reviews.ip_hash 露出)と同じ「grant 実査で締める」対応。
--   書き込みは全て service_role 経由 / 読み取りは definer RPC 経由に一本化済みの
--   ため、anon/authenticated のテーブル直 grant は toilets の SELECT 以外不要。
-- 影響なしの根拠(2026-07-08 実査):
--   - anon/authenticated でテーブルを直接 .from() する箇所は src に無い
--     (admin 画面・seed は service_role、地図/申請の読み取りは definer RPC)。
--   - service_role の grant には触れない(015/016 で調整済みの状態を維持)。
-- ----------------------------------------------------------------------------
revoke all on public.reviews from anon, authenticated;
revoke all on public.toilet_submissions from anon, authenticated;
revoke all on public.submission_confirmations from anon, authenticated;
revoke all on public.admin_edits from anon, authenticated;
revoke all on public.ai_suggestions from anon, authenticated;

-- toilets のみ「公開読み取り」を明示的に維持する。
-- WHY: 001 の policy "public read toilets"(SELECT using(true))とセットで、
--   公開データとしての直接読み取りを許す設計は変えない(全国マップの公共データ)。
--   一度 revoke all してから SELECT だけ grant し直すことで、
--   TRUNCATE 等の余計な残存 grant だけを確実に落とす。
revoke all on public.toilets from anon, authenticated;
grant select on public.toilets to anon, authenticated;

-- ----------------------------------------------------------------------------
-- (6) nearby_toilet の anon/authenticated EXECUTE を閉じる
--
-- WHY: 008 で anon にも grant されていたが(008:287)、実査の結果 src からの
--   直接呼び出しはゼロで、submit_toilet(SECURITY DEFINER, owner=postgres)の
--   内部呼び出し(008:214)専用だった。definer チェーン内の実行ロールは postgres
--   (= 関数 owner なので EXECUTE 常時可)のため、anon から閉じても申請フローは
--   壊れない。座標総当たりでの pending 申請位置の探索(プライバシー面)も塞がる。
--   service_role は保守・デバッグ用に維持。
--   WHY PUBLIC も revoke(Codex ゲート1 指摘 #4・採用): Postgres の関数は既定で
--   PUBLIC に EXECUTE が付き、008 は nearby_toilet について PUBLIC を revoke して
--   いない。anon/authenticated だけ revoke しても PUBLIC 経由の実効 EXECUTE が
--   残って無意味になる(submit_toilet は 008:294 で PUBLIC から revoke 済みという
--   対比に注意 — この非対称が今回の見落としの原因)。
-- ----------------------------------------------------------------------------
revoke execute on function public.nearby_toilet(double precision, double precision, double precision) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- (7) 今後のテーブルへのデフォルト権限を締める(再発防止)
--
-- WHY: (5) の掃除をしても、デフォルト権限が残っていると「次に作るテーブル」で
--   同じ残存 grant が再発する。001:121 の
--   `alter default privileges in schema public grant select on tables to anon, ...`
--   はこの REVOKE で上書き廃止する(001 の設計判断の意図的な変更)。
--   今後 anon に読ませたい公開テーブルを作る場合は、migration で
--   `grant select on <table> to anon, authenticated;` を明示すること。
--   ensure_rls event trigger(RLS 自動有効化)と合わせて
--   「新テーブル = RLS 有効 + anon grant ゼロ」がデフォルトになる。
--   service_role のデフォルト権限は維持(利便性優先。締めが必要なテーブルは
--   015/016 のように個別 REVOKE する運用)。
-- ----------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- ============================================================================
-- 適用後の検証(必須 — feedback_db_rpc_live_smoke / 「結果が無ければ起きていない」):
--
-- 1. ACL 実査:
--    select c.relname, c.relrowsecurity, c.relacl::text from pg_class c
--    join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relname in
--      ('spatial_ref_sys','toilet_stats','toilets','reviews','toilet_submissions',
--       'submission_confirmations','admin_edits','ai_suggestions');
--    期待: アプリテーブルの anon/authenticated grant が toilets=r のみ。
--          spatial_ref_sys は relrowsecurity=true か、変わらなければサポート依頼へ。
--
-- 2. live smoke(本番。toilet_stats 依存 RPC 9 つを全てカバーする — Codex 合意 d):
--    - GET /api/toilets?bbox=... が 200 + 件数正常(toilets_in_bbox → toilet_stats 経由)
--    - GET /api/submissions?bbox=... が 200(pending_submissions_in_bbox, anon 維持)
--    - /toilet/[id] SSR ページが 200(toilet_by_id)
--    - /area/[region] ページが 200(toilets_in_region / toilets_in_region_count)
--    - /sitemap/0.xml と /sitemap/1.xml が 200(toilet_ids_indexable_page /
--      toilet_indexable_count / toilet_ids_page / toilet_count)
--    - POST /api/reviews が 200(service_role insert。route.ts:90 は NextResponse.json
--      デフォルトの 200 を返す — Codex ゲート2 で期待値 201 の誤記を検出・修正)
--    - POST /api/submissions が 200/201(submit_toilet → 内部 nearby_toilet が
--      revoke 後も definer チェーンで動くことの確認)
--    - anon key で POST /rest/v1/rpc/nearby_toilet → 401/42501 で拒否されること
--      ((6) の効果検証。PUBLIC 残存だとここが 200 になってしまう)
--    - anon key で spatial_ref_sys への DELETE/UPDATE が拒否されること +
--      select count(*) from spatial_ref_sys where srid=4326 が anon 相当で読めること
--      ((1) が効いた場合の効果/非破壊の両面検証)
--    - /admin ログイン → 一覧表示(service_role read)
--    - Realtime/GraphQL: 本番プロジェクトで未使用であることを確認
--      (pg_publication_tables にアプリテーブルが無いこと)
--
-- 3. get_advisors(security) 再実行:
--    期待: security_definer_view / function_search_path_mutable /
--          rls_auto_enable・nearby_toilet の WARN が消える。
--          spatial_ref_sys の ERROR は (1) が権限不足だった場合残る(サポート依頼で解消)。
-- ============================================================================
