-- 011_admin_edits.sql — Phase A: /admin 手動編集の「監査ログ(audit trail)」
-- 実行: Supabase ダッシュボード > SQL Editor で全文ペースト → Run(または supabase db push)。冪等。
-- ⚠️ デプロイ前に手動 apply が必要(005/006/007/008/009/010 と同様)。未適用のまま deploy すると
--    PATCH /api/admin/toilets/[id] が admin_edits 不在で 500 になる。
--
-- 設計(docs/progress/PROGRESS-admin-ai.md §Phase A・監査ログ):
--  - admin / AI による toilets の編集を before/after 付きで完全記録する。改ざん耐性のため append-only。
--  - 取消(undo)も「新たな edit を追記」して実現する(過去レコードは絶対に書き換えない)。
--  - editor は 'admin'(手動)/ 'ai'(Phase B のオンデマンド反映)の 2 値。Phase A では 'admin' のみ使う。
--
-- 新ファイル方針: 既存 001-010 は書き換えない。監査ログは本 011 に独立して足す。

-- ───────────────────────────────────────────────────────────────────
-- (1) 監査ログテーブル
-- ───────────────────────────────────────────────────────────────────
-- changed_fields: 今回の編集で実際に変わった列名の配列(jsonb 配列)。差分の一覧表示用。
-- before/after: 変更対象列だけを抜き出したスナップショット(jsonb オブジェクト)。取消は after→before へ戻す。
-- source_review_id: その編集の根拠になったレビュー(Phase B で AI が参照したコメント等)。Phase A は null。
--   reviews への FK にすると、レビューが将来削除されたとき監査が連鎖削除されるのは望ましくない
--   (監査は永続記録)。よって FK を張らず uuid をそのまま持つ(ON DELETE で監査を失わない)。
-- toilet_id も同様に FK を張らない: トイレが削除されても「過去に何を編集したか」の記録は残すべき。
--
-- ★★ edit_seq(単調増加 identity)= 「最新 edit」判定の唯一の真実(single source of truth)★★
--   Codex 再レビュー R2[high]: undo の「最新 edit」判定を created_at desc にすると壊れる。理由:
--     (1) created_at は default now()。同一トイレへ近接して RPC が走る/手動で挿入すると timestamptz が
--         タイ(完全一致)になりうる。タイのとき Postgres は order by の順序を保証しない(非決定)。
--     (2) id は gen_random_uuid()(v4)で時系列に単調でない → タイブレークにも使えない。
--   この 2 点が重なると「古い edit を最新と誤判定して取り消す」= 「最新のみ取消」の不変条件が破れ、
--   後続編集を黙って巻き戻すデータ破壊が起きうる。
--   → identity 列 edit_seq を「挿入順に厳密単調増加する serial」として持ち、これを「最新」の唯一の根拠にする。
--      created_at は人間向けの表示時刻に降格(順序判定には二度と使わない)。
--   ⚠️ 後任 AI へ: undo / 監査履歴の「最新順」を created_at に戻さないこと(上記 (1)(2) で非決定に逆戻りする)。
--      順序は常に edit_seq desc。created_at は表示専用。
create table if not exists admin_edits (
  id uuid primary key default gen_random_uuid(),
  -- 挿入順に厳密単調増加。タイも欠番再利用も無く、「最新 = max(edit_seq)」が常に一意に決まる。
  edit_seq bigint generated always as identity,
  toilet_id uuid not null,
  -- 編集主体。手動 admin か AI 自動反映か。Phase B の監査・取消で由来を区別するため必須。
  editor text not null check (editor in ('admin', 'ai')),
  changed_fields jsonb not null,
  before jsonb not null,
  after jsonb not null,
  source_review_id uuid,
  created_at timestamptz not null default now()
);

-- ⚠️ 既に 011 を適用済みの環境(edit_seq 追加前にテーブルが出来ていた場合)向けの後付けガード。
--   本ファイルは「未適用が前提(まだどの環境にも入っていない新規 migration)」だが、CREATE TABLE IF NOT EXISTS は
--   既存テーブルに列を足さないため、万一旧定義が残っていても自己修復できるよう identity 列を冪等に補う。
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'admin_edits' and column_name = 'edit_seq'
  ) then
    alter table admin_edits add column edit_seq bigint generated always as identity;
  end if;
end $$;

-- トイレ単位の履歴 + 「そのトイレの最新 edit(max edit_seq)」取得用。undo はこの index を使う。
--   created_at ではなく edit_seq desc を引く(順序の唯一の真実が edit_seq だから)。
create index if not exists admin_edits_toilet_seq_idx on admin_edits(toilet_id, edit_seq desc);
-- ダッシュボードの「直近の履歴(全トイレ横断)」表示用。これも edit_seq desc で「挿入順の最新」を厳密に出す。
create index if not exists admin_edits_seq_idx on admin_edits(edit_seq desc);

-- ───────────────────────────────────────────────────────────────────
-- (2) append-only guard(改ざん防止)
-- ───────────────────────────────────────────────────────────────────
-- 監査ログは追記専用。UPDATE/DELETE を trigger で禁止し不変条件化する(008 の ledger と同パターン)。
-- WHY trigger(RLS ではない): admin 書き込みは service_role(secret key)で行うが、service_role は
--   RLS を bypass する。RLS ポリシーだけでは service_role 経由の UPDATE/DELETE を止められないため、
--   row-level trigger で物理的に拒否する。これにより「取消も追記でしか表現できない」設計が DB で保証される。
create or replace function forbid_admin_edits_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'admin_edits is append-only (% not allowed)', tg_op;
end;
$$;

drop trigger if exists admin_edits_no_mutation on admin_edits;
create trigger admin_edits_no_mutation
  before update or delete on admin_edits
  for each row execute function forbid_admin_edits_mutation();

-- ───────────────────────────────────────────────────────────────────
-- (3) RLS + GRANT
-- ───────────────────────────────────────────────────────────────────
-- 監査ログは運営専用。anon/authenticated には一切開けない(読み書きとも)。
-- RLS 有効 + ポリシー無し = 非 bypass ロールは全拒否。書き込みは service_role(secret key の API ルート)のみ。
-- WHY insert のみ(update/delete を grant しない): trigger でも止めるが、権限レベルでも最小化しておく
--   (多層防御 — grant が漏れても trigger が止め、trigger が漏れても grant が止める)。
alter table admin_edits enable row level security;

grant select, insert on admin_edits to service_role;
