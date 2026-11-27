-- 20261127213301_review_facilities_and_submission_queue.sql — Issue #50
-- 旧番号 020: PR #55 が 019_osm_sync.sql を使うため、当時 020 とした。019 とは別のテーブル・関数だけを触るので、019 の適用有無に依存しない。
-- 実行: Supabase ダッシュボード > SQL Editor で全文ペースト → Run(または supabase db push)。冪等。
-- 本番は 2026-11-27 にバージョン 20261127213301（名前 review_facilities_and_submission_queue）として適用済み。
--    未適用の環境ではレビュー API / 管理キューのコードが走ると RPC 不在で 500 になる。
--    適用順: 001–018(と 019 があれば 019)のあと本ファイル → live smoke → コードを本番へ。
-- ⚠️ live smoke 必須: plpgsql の行ロック・30m 重複・承認時だけ toilets を書くことは vitest モックでは見えない。
--
-- やること:
--   1. reviews に任意の設備列を足す(紙・石けん・おむつ台・営業時間。ウォシュレットは既存)。
--      これらは「ユーザーが言ったこと」の記録であり、toilets 列へは自動でコピーしない。
--   2. review_facility_claims: レビュー起点の設備を 1 列 1 行の承認キューにする。
--      承認時だけ admin_apply_edit を呼び、toilets 更新と admin_edits 追記を同一トランザクションにする。
--      却下はキューの status だけを変え、toilets を触らない。OSM 行を含む既存ピンの無断上書きはしない。
--   3. admin_decide_submission: pending の toilet_submissions を手動承認/却下する。
--      承認は既存の自動昇格と同じ INSERT(source='user')。却下は本番に行を作らない。
--      confirm_count>=3 の自動昇格(submit_toilet)はそのまま残す。
--   4. admin_apply_edit / admin_undo_edit の allowlist に has_paper / has_soap を足す。
--      シグネチャは 014 の 4 引数のまま(引数を増やすとオーバーロードが残る。014 High①)。
--
-- 個人情報: 新しい列に名前・メール・電話は無い。ip_hash は既存 reviews / toilet_submissions のまま。
-- キュー用 RPC は ip_hash を返さない。

-- ───────────────────────────────────────────────────────────────────
-- (1) reviews に任意設備列
-- ───────────────────────────────────────────────────────────────────
alter table reviews add column if not exists has_paper boolean;
alter table reviews add column if not exists has_soap boolean;
alter table reviews add column if not exists has_diaper_table boolean;
alter table reviews add column if not exists opening_hours text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reviews_opening_hours_len' and conrelid = 'public.reviews'::regclass
  ) then
    alter table reviews
      add constraint reviews_opening_hours_len
      check (opening_hours is null or char_length(opening_hours) <= 200);
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- (2) review_facility_claims — 承認キュー(監査原本ではない)
-- ───────────────────────────────────────────────────────────────────
-- 不変な監査は承認時の admin_edits に一本化する(ai_suggestions と同じ役割分担)。
-- status は pending → approved / rejected / no_op / superseded。物理削除しない。
-- 同一トイレ×同一列の pending は 1 件。後から違う値が来たら、既存の pending を superseded にして
-- 新しい id の行を pending で足す(黙って捨てると「紙あり」のあとの「紙なし」がキューに残らない)。
-- 行の review_id / value は作成後に書き換えない。管理画面は claim id で承認するので、
-- 画面に出した値と承認で反映する値が必ず一致する(古い id の承認は claim not pending = 409)。
create table if not exists review_facility_claims (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  review_id uuid not null,
  toilet_id uuid not null,
  field text not null check (field in (
    'has_paper', 'has_washlet', 'has_soap', 'has_diaper_table', 'opening_hours'
  )),
  value jsonb not null,
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected', 'no_op', 'superseded'
  )),
  applied_edit_seq bigint,
  reviewed_by text,
  rejected_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists review_facility_claims_pending_uq
  on review_facility_claims (toilet_id, field)
  where status = 'pending';

create index if not exists review_facility_claims_status_seq_idx
  on review_facility_claims (status, seq desc);

alter table review_facility_claims enable row level security;

revoke all on review_facility_claims from public, anon, authenticated;
grant select, insert, update on review_facility_claims to service_role;
revoke delete, truncate on review_facility_claims from service_role;

-- ───────────────────────────────────────────────────────────────────
-- (3) admin_apply_edit — 014 の 4 引数版に has_paper / has_soap を足す
-- ───────────────────────────────────────────────────────────────────
-- 3 引数版が残っていると named-arg の 3 引数呼び出しが旧版に解決される(014 High①)。
-- 014 適用済みならこの DROP は no-op。未適用でも 4 引数版だけが残る。
drop function if exists admin_apply_edit(uuid, text, jsonb);

create or replace function admin_apply_edit(
  p_toilet_id uuid,
  p_editor text,
  p_patch jsonb,
  p_source_review_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_current toilets%rowtype;
  v_changed text[] := '{}';
  v_before jsonb := '{}'::jsonb;
  v_after  jsonb := '{}'::jsonb;
  v_edit_id uuid;
  v_name text;
  v_inferred_access text;
  v_has_washlet boolean;
  v_has_paper boolean;
  v_has_soap boolean;
  v_has_diaper_table boolean;
  v_is_universal boolean;
  v_opening_hours text;
begin
  if p_editor not in ('admin', 'ai') then
    raise exception 'admin_rpc: invalid editor';
  end if;

  select * into v_current from toilets where id = p_toilet_id for update;
  if not found then
    raise exception 'admin_rpc: toilet not found';
  end if;

  -- 許可列: 014 の 6 列 + has_paper + has_soap。
  -- source / dominant_access は触らない(OSM 由来の source を承認で書き換えない)。
  -- 未知キーは読まない。`array_append` を使う(`|| 'literal'` は malformed array literal、013)。

  if p_patch ? 'name' then
    v_name := p_patch->>'name';
    if v_current.name is distinct from v_name then
      v_changed := array_append(v_changed, 'name');
      v_before := v_before || jsonb_build_object('name', to_jsonb(v_current.name));
      v_after  := v_after  || jsonb_build_object('name', to_jsonb(v_name));
    end if;
  end if;

  if p_patch ? 'inferred_access' then
    v_inferred_access := p_patch->>'inferred_access';
    if v_inferred_access is null or v_inferred_access not in ('open', 'ask', 'permission') then
      raise exception 'admin_rpc: invalid inferred_access';
    end if;
    if v_current.inferred_access::text is distinct from v_inferred_access then
      v_changed := array_append(v_changed, 'inferred_access');
      v_before := v_before || jsonb_build_object('inferred_access', to_jsonb(v_current.inferred_access::text));
      v_after  := v_after  || jsonb_build_object('inferred_access', to_jsonb(v_inferred_access));
    end if;
  end if;

  if p_patch ? 'has_washlet' then
    v_has_washlet := (p_patch->>'has_washlet')::boolean;
    if v_current.has_washlet is distinct from v_has_washlet then
      v_changed := array_append(v_changed, 'has_washlet');
      v_before := v_before || jsonb_build_object('has_washlet', to_jsonb(v_current.has_washlet));
      v_after  := v_after  || jsonb_build_object('has_washlet', to_jsonb(v_has_washlet));
    end if;
  end if;

  if p_patch ? 'has_paper' then
    v_has_paper := (p_patch->>'has_paper')::boolean;
    if v_current.has_paper is distinct from v_has_paper then
      v_changed := array_append(v_changed, 'has_paper');
      v_before := v_before || jsonb_build_object('has_paper', to_jsonb(v_current.has_paper));
      v_after  := v_after  || jsonb_build_object('has_paper', to_jsonb(v_has_paper));
    end if;
  end if;

  if p_patch ? 'has_soap' then
    v_has_soap := (p_patch->>'has_soap')::boolean;
    if v_current.has_soap is distinct from v_has_soap then
      v_changed := array_append(v_changed, 'has_soap');
      v_before := v_before || jsonb_build_object('has_soap', to_jsonb(v_current.has_soap));
      v_after  := v_after  || jsonb_build_object('has_soap', to_jsonb(v_has_soap));
    end if;
  end if;

  if p_patch ? 'has_diaper_table' then
    v_has_diaper_table := (p_patch->>'has_diaper_table')::boolean;
    if v_current.has_diaper_table is distinct from v_has_diaper_table then
      v_changed := array_append(v_changed, 'has_diaper_table');
      v_before := v_before || jsonb_build_object('has_diaper_table', to_jsonb(v_current.has_diaper_table));
      v_after  := v_after  || jsonb_build_object('has_diaper_table', to_jsonb(v_has_diaper_table));
    end if;
  end if;

  if p_patch ? 'is_universal' then
    v_is_universal := (p_patch->>'is_universal')::boolean;
    if v_current.is_universal is distinct from v_is_universal then
      v_changed := array_append(v_changed, 'is_universal');
      v_before := v_before || jsonb_build_object('is_universal', to_jsonb(v_current.is_universal));
      v_after  := v_after  || jsonb_build_object('is_universal', to_jsonb(v_is_universal));
    end if;
  end if;

  if p_patch ? 'opening_hours' then
    v_opening_hours := p_patch->>'opening_hours';
    if v_current.opening_hours is distinct from v_opening_hours then
      v_changed := array_append(v_changed, 'opening_hours');
      v_before := v_before || jsonb_build_object('opening_hours', to_jsonb(v_current.opening_hours));
      v_after  := v_after  || jsonb_build_object('opening_hours', to_jsonb(v_opening_hours));
    end if;
  end if;

  if array_length(v_changed, 1) is null then
    return jsonb_build_object('applied', false, 'edit_id', null, 'changed_fields', '[]'::jsonb);
  end if;

  update toilets set
    name             = case when v_after ? 'name'             then v_name             else name end,
    inferred_access  = case when v_after ? 'inferred_access'  then v_inferred_access::access_level else inferred_access end,
    has_washlet      = case when v_after ? 'has_washlet'      then v_has_washlet      else has_washlet end,
    has_paper        = case when v_after ? 'has_paper'        then v_has_paper        else has_paper end,
    has_soap         = case when v_after ? 'has_soap'         then v_has_soap         else has_soap end,
    has_diaper_table = case when v_after ? 'has_diaper_table' then v_has_diaper_table else has_diaper_table end,
    is_universal     = case when v_after ? 'is_universal'     then v_is_universal     else is_universal end,
    opening_hours    = case when v_after ? 'opening_hours'    then v_opening_hours    else opening_hours end
  where id = p_toilet_id;

  insert into admin_edits (toilet_id, editor, changed_fields, before, after, source_review_id)
  values (p_toilet_id, p_editor, to_jsonb(v_changed), v_before, v_after, p_source_review_id)
  returning id into v_edit_id;

  return jsonb_build_object('applied', true, 'edit_id', v_edit_id, 'changed_fields', to_jsonb(v_changed));
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (4) admin_undo_edit — has_paper / has_soap の取消も戻す
-- ───────────────────────────────────────────────────────────────────
-- 014 は undo を書き換えていない。紙・石けんを apply できるようにしたので、
-- 取消がこの 2 列を無視すると「取消しました」の監査だけ残り列が戻らない。
create or replace function admin_undo_edit(
  p_toilet_id uuid,
  p_edit_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_current toilets%rowtype;
  v_latest admin_edits%rowtype;
  v_changed text[];
  v_field text;
  v_undo_id uuid;
  v_name text;
  v_inferred_access text;
  v_has_washlet boolean;
  v_has_paper boolean;
  v_has_soap boolean;
  v_has_diaper_table boolean;
  v_is_universal boolean;
  v_opening_hours text;
begin
  select * into v_current from toilets where id = p_toilet_id for update;
  if not found then
    raise exception 'admin_rpc: toilet not found';
  end if;

  -- 最新判定は edit_seq desc。created_at には戻さない(011/012)。
  select * into v_latest
  from admin_edits
  where toilet_id = p_toilet_id
  order by edit_seq desc
  limit 1;
  if not found then
    raise exception 'admin_rpc: no edit to undo';
  end if;

  if v_latest.id <> p_edit_id then
    raise exception 'admin_rpc: edit is not latest';
  end if;

  v_changed := array(select jsonb_array_elements_text(v_latest.changed_fields));

  foreach v_field in array v_changed loop
    if v_field = 'name' then
      if v_current.name is distinct from nullif_jsonb_text(v_latest.after, 'name') then
        raise exception 'admin_rpc: current value drifted';
      end if;
    elsif v_field = 'inferred_access' then
      if v_current.inferred_access::text is distinct from (v_latest.after->>'inferred_access') then
        raise exception 'admin_rpc: current value drifted';
      end if;
    elsif v_field = 'has_washlet' then
      if v_current.has_washlet is distinct from jsonb_to_bool(v_latest.after, 'has_washlet') then
        raise exception 'admin_rpc: current value drifted';
      end if;
    elsif v_field = 'has_paper' then
      if v_current.has_paper is distinct from jsonb_to_bool(v_latest.after, 'has_paper') then
        raise exception 'admin_rpc: current value drifted';
      end if;
    elsif v_field = 'has_soap' then
      if v_current.has_soap is distinct from jsonb_to_bool(v_latest.after, 'has_soap') then
        raise exception 'admin_rpc: current value drifted';
      end if;
    elsif v_field = 'has_diaper_table' then
      if v_current.has_diaper_table is distinct from jsonb_to_bool(v_latest.after, 'has_diaper_table') then
        raise exception 'admin_rpc: current value drifted';
      end if;
    elsif v_field = 'is_universal' then
      if v_current.is_universal is distinct from jsonb_to_bool(v_latest.after, 'is_universal') then
        raise exception 'admin_rpc: current value drifted';
      end if;
    elsif v_field = 'opening_hours' then
      if v_current.opening_hours is distinct from nullif_jsonb_text(v_latest.after, 'opening_hours') then
        raise exception 'admin_rpc: current value drifted';
      end if;
    end if;
  end loop;

  v_name := nullif_jsonb_text(v_latest.before, 'name');
  v_inferred_access := v_latest.before->>'inferred_access';
  v_has_washlet := jsonb_to_bool(v_latest.before, 'has_washlet');
  v_has_paper := jsonb_to_bool(v_latest.before, 'has_paper');
  v_has_soap := jsonb_to_bool(v_latest.before, 'has_soap');
  v_has_diaper_table := jsonb_to_bool(v_latest.before, 'has_diaper_table');
  v_is_universal := jsonb_to_bool(v_latest.before, 'is_universal');
  v_opening_hours := nullif_jsonb_text(v_latest.before, 'opening_hours');

  update toilets set
    name             = case when v_latest.before ? 'name'             then v_name                          else name end,
    inferred_access  = case when v_latest.before ? 'inferred_access'  then v_inferred_access::access_level else inferred_access end,
    has_washlet      = case when v_latest.before ? 'has_washlet'      then v_has_washlet                   else has_washlet end,
    has_paper        = case when v_latest.before ? 'has_paper'        then v_has_paper                     else has_paper end,
    has_soap         = case when v_latest.before ? 'has_soap'         then v_has_soap                      else has_soap end,
    has_diaper_table = case when v_latest.before ? 'has_diaper_table' then v_has_diaper_table              else has_diaper_table end,
    is_universal     = case when v_latest.before ? 'is_universal'     then v_is_universal                  else is_universal end,
    opening_hours    = case when v_latest.before ? 'opening_hours'    then v_opening_hours                 else opening_hours end
  where id = p_toilet_id;

  insert into admin_edits (toilet_id, editor, changed_fields, before, after, source_review_id)
  values (p_toilet_id, 'admin', v_latest.changed_fields, v_latest.after, v_latest.before, null)
  returning id into v_undo_id;

  return jsonb_build_object('restored', to_jsonb(v_changed), 'undo_edit_id', v_undo_id);
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (5) insert_review_with_claims
-- ───────────────────────────────────────────────────────────────────
-- レビュー INSERT と、明示された設備だけの pending 行を同一トランザクションで書く。
-- null / 報告モードはキューに積まない。toilets は更新しない。
create or replace function insert_review_with_claims(
  p_toilet_id uuid,
  p_rating integer,
  p_access access_level,
  p_has_washlet boolean,
  p_has_paper boolean,
  p_has_soap boolean,
  p_has_diaper_table boolean,
  p_opening_hours text,
  p_comment text,
  p_ip_hash text,
  p_not_a_toilet boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_review_id uuid;
  v_report boolean := coalesce(p_not_a_toilet, false);
  v_washlet boolean;
  v_paper boolean;
  v_soap boolean;
  v_diaper boolean;
  v_hours text;
  v_field text;
  v_value jsonb;
  v_attempt integer;
  v_pending_id uuid;
  v_pending_value jsonb;
begin
  if v_report then
    v_washlet := null;
    v_paper := null;
    v_soap := null;
    v_diaper := null;
    v_hours := null;
  else
    v_washlet := p_has_washlet;
    v_paper := p_has_paper;
    v_soap := p_has_soap;
    v_diaper := p_has_diaper_table;
    v_hours := nullif(btrim(coalesce(p_opening_hours, '')), '');
  end if;

  if v_hours is not null and char_length(v_hours) > 200 then
    raise exception 'review_rpc: opening_hours too long';
  end if;

  insert into reviews (
    toilet_id, rating, access_level, has_washlet, has_paper, has_soap,
    has_diaper_table, opening_hours, comment, ip_hash, not_a_toilet
  ) values (
    p_toilet_id, p_rating, p_access, v_washlet, v_paper, v_soap,
    v_diaper, v_hours, p_comment, p_ip_hash, v_report
  )
  returning id into v_review_id;

  if v_report then
    return v_review_id;
  end if;

  -- 設備ごとに 1 行。ロック順はトイレ → claim(admin_decide_facility_claim と同じ)。
  -- reviews の INSERT が外部キーでトイレ行に KEY SHARE を取った後に claim を触る。
  foreach v_field in array array['has_paper', 'has_washlet', 'has_soap', 'has_diaper_table', 'opening_hours']
  loop
    v_value := case v_field
      when 'has_paper' then to_jsonb(v_paper)
      when 'has_washlet' then to_jsonb(v_washlet)
      when 'has_soap' then to_jsonb(v_soap)
      when 'has_diaper_table' then to_jsonb(v_diaper)
      else to_jsonb(v_hours)
    end;
    if v_value is null or v_value = 'null'::jsonb then
      continue;
    end if;

    -- 既存の pending は書き換えない。同値なら何もしない。違う値なら superseded にして新しい行を足す。
    -- 同時に 2 件来て INSERT が衝突したら、相手の行を読み直してもう一度判定する。
    for v_attempt in 1..3 loop
      select id, value into v_pending_id, v_pending_value
      from review_facility_claims
      where toilet_id = p_toilet_id and field = v_field and status = 'pending'
      for update;

      if found then
        exit when v_pending_value = v_value;
        update review_facility_claims set
          status = 'superseded',
          reviewed_at = now()
        where id = v_pending_id;
      end if;

      insert into review_facility_claims (review_id, toilet_id, field, value)
      values (v_review_id, p_toilet_id, v_field, v_value)
      on conflict (toilet_id, field) where status = 'pending' do nothing;
      exit when found;
    end loop;
  end loop;

  return v_review_id;
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (6) admin_decide_facility_claim
-- ───────────────────────────────────────────────────────────────────
-- approve: admin_apply_edit(editor='admin') で本番列 + admin_edits。同一 tx。
-- reject: status のみ。toilets も admin_edits も書かない。
create or replace function admin_decide_facility_claim(
  p_claim_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_claim review_facility_claims%rowtype;
  v_patch jsonb;
  v_apply jsonb;
  v_applied boolean;
  v_edit_id uuid;
  v_edit_seq bigint;
  v_changed jsonb;
  v_status text;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 300), '');
  v_toilet_id uuid;
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'admin_rpc: invalid action';
  end if;

  -- ロック順はトイレ → claim(insert_review_with_claims と同じ)。
  -- 先に claim を握ってから admin_apply_edit でトイレを FOR UPDATE すると、
  -- トイレに KEY SHARE を持ったまま claim を待つレビュー INSERT とデッドロックする。
  -- toilet_id は作成後に変わらないので、ロック無しで読んでからトイレ → claim の順に握る。
  select toilet_id into v_toilet_id from review_facility_claims where id = p_claim_id;
  if not found then
    raise exception 'admin_rpc: claim not found';
  end if;

  if p_action = 'approve' then
    perform 1 from toilets where id = v_toilet_id for update;
    if not found then
      raise exception 'admin_rpc: toilet not found';
    end if;
  end if;

  select * into v_claim from review_facility_claims where id = p_claim_id for update;
  if not found then
    raise exception 'admin_rpc: claim not found';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'admin_rpc: claim not pending';
  end if;

  if p_action = 'reject' then
    update review_facility_claims set
      status = 'rejected',
      reviewed_by = 'admin',
      rejected_reason = v_reason,
      reviewed_at = now()
    where id = p_claim_id;
    return jsonb_build_object(
      'applied', false,
      'status', 'rejected',
      'edit_id', null,
      'changed_fields', '[]'::jsonb
    );
  end if;

  if v_claim.field = 'opening_hours' then
    if jsonb_typeof(v_claim.value) <> 'string' then
      raise exception 'admin_rpc: invalid facility value';
    end if;
    if char_length(v_claim.value #>> '{}') > 200 then
      raise exception 'admin_rpc: opening_hours too long';
    end if;
  elsif jsonb_typeof(v_claim.value) <> 'boolean' then
    raise exception 'admin_rpc: invalid facility value';
  end if;

  -- value は既に jsonb。jsonb_build_object は jsonb 引数を to_jsonb 経由でそのまま埋め込む。
  v_patch := jsonb_build_object(v_claim.field, v_claim.value);
  v_apply := admin_apply_edit(v_claim.toilet_id, 'admin', v_patch, v_claim.review_id);
  v_applied := coalesce((v_apply->>'applied')::boolean, false);
  v_changed := coalesce(v_apply->'changed_fields', '[]'::jsonb);

  if v_applied then
    v_edit_id := (v_apply->>'edit_id')::uuid;
    select edit_seq into v_edit_seq from admin_edits where id = v_edit_id;
    v_status := 'approved';
    update review_facility_claims set
      status = v_status,
      applied_edit_seq = v_edit_seq,
      reviewed_by = 'admin',
      reviewed_at = now()
    where id = p_claim_id;
  else
    v_status := 'no_op';
    update review_facility_claims set
      status = v_status,
      reviewed_by = 'admin',
      reviewed_at = now()
    where id = p_claim_id;
  end if;

  return jsonb_build_object(
    'applied', v_applied,
    'status', v_status,
    'edit_id', v_edit_id,
    'changed_fields', v_changed
  );
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (7) admin_decide_submission — pending の手動承認 / 却下
-- ───────────────────────────────────────────────────────────────────
-- ロック順は submit_toilet(008)と同じ advisory lock → 行ロック。逆にするとデッドロックする。
-- 承認時の INSERT 列は自動昇格と同一(name, location, source='user', inferred_access, is_universal)。
-- 30m 以内に可視トイレがあれば挿入せず例外(申請時の dup を承認時にも掛ける)。
-- 却下は status のみ。toilets へは INSERT しない。
create or replace function admin_decide_submission(
  p_submission_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_sub toilet_submissions%rowtype;
  v_lat double precision;
  v_lng double precision;
  v_cell constant double precision := 0.001;
  v_lat_pad constant double precision := 0.0005;
  v_lng_pad double precision;
  v_la int;
  v_lo int;
  v_existing uuid;
  v_new_toilet uuid;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 300), '');
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'admin_rpc: invalid action';
  end if;

  select * into v_sub from toilet_submissions where id = p_submission_id;
  if not found then
    raise exception 'admin_rpc: submission not found';
  end if;

  v_lat := st_y(v_sub.location::geometry);
  v_lng := st_x(v_sub.location::geometry);
  v_lng_pad := 0.0005 / greatest(cos(radians(v_lat)), 0.01);
  for v_la in floor((v_lat - v_lat_pad) / v_cell)::int .. floor((v_lat + v_lat_pad) / v_cell)::int loop
    for v_lo in floor((v_lng - v_lng_pad) / v_cell)::int .. floor((v_lng + v_lng_pad) / v_cell)::int loop
      perform pg_advisory_xact_lock(hashtext(v_la::text || ':' || v_lo::text)::bigint);
    end loop;
  end loop;

  select * into v_sub from toilet_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'admin_rpc: submission not found';
  end if;
  if v_sub.status <> 'pending' then
    raise exception 'admin_rpc: submission not pending';
  end if;

  if p_action = 'reject' then
    update toilet_submissions set
      status = 'rejected',
      reviewed_by = 'admin',
      rejected_reason = v_reason
    where id = p_submission_id;
    return jsonb_build_object(
      'result', 'rejected',
      'status', 'rejected',
      'toilet_id', null
    );
  end if;

  v_lat := st_y(v_sub.location::geometry);
  v_lng := st_x(v_sub.location::geometry);
  v_existing := nearby_toilet(v_lat, v_lng, 30);
  if v_existing is not null then
    raise exception 'admin_rpc: nearby toilet exists';
  end if;

  insert into toilets (name, location, source, inferred_access, is_universal)
  select s.name, s.location, 'user', s.access_level, s.is_universal
  from toilet_submissions s
  where s.id = p_submission_id
  returning id into v_new_toilet;

  update toilet_submissions set
    status = 'approved',
    promoted_toilet_id = v_new_toilet,
    reviewed_by = 'admin',
    review_note = v_reason
  where id = p_submission_id;

  return jsonb_build_object(
    'result', 'approved',
    'status', 'approved',
    'toilet_id', v_new_toilet
  );
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (8) 管理画面用の pending 一覧(ip_hash を返さない)
-- ───────────────────────────────────────────────────────────────────
create or replace function admin_pending_submissions(p_limit integer default 50)
returns table (
  id uuid,
  name text,
  access_level text,
  is_outdoor boolean,
  is_universal boolean,
  comment text,
  confirm_count integer,
  lat double precision,
  lng double precision,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.name,
    s.access_level::text,
    s.is_outdoor,
    s.is_universal,
    s.comment,
    s.confirm_count,
    st_y(s.location::geometry) as lat,
    st_x(s.location::geometry) as lng,
    s.created_at
  from toilet_submissions s
  where s.status = 'pending'
  order by s.created_at desc, s.id desc
  limit greatest(coalesce(p_limit, 50), 0);
$$;

-- ───────────────────────────────────────────────────────────────────
-- (9) GRANT — service_role のみ。新規関数は PUBLIC EXECUTE が既定で付く
-- ───────────────────────────────────────────────────────────────────
revoke execute on function admin_apply_edit(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function admin_apply_edit(uuid, text, jsonb, uuid) to service_role;

revoke execute on function admin_undo_edit(uuid, uuid) from public, anon, authenticated;
grant execute on function admin_undo_edit(uuid, uuid) to service_role;

revoke execute on function insert_review_with_claims(uuid, integer, access_level, boolean, boolean, boolean, boolean, text, text, text, boolean) from public, anon, authenticated;
grant execute on function insert_review_with_claims(uuid, integer, access_level, boolean, boolean, boolean, boolean, text, text, text, boolean) to service_role;

revoke execute on function admin_decide_facility_claim(uuid, text, text) from public, anon, authenticated;
grant execute on function admin_decide_facility_claim(uuid, text, text) to service_role;

revoke execute on function admin_decide_submission(uuid, text, text) from public, anon, authenticated;
grant execute on function admin_decide_submission(uuid, text, text) to service_role;

revoke execute on function admin_pending_submissions(integer) from public, anon, authenticated;
grant execute on function admin_pending_submissions(integer) to service_role;

-- LIVE SMOKE(本番適用後、コードの本番反映前):
-- ① レビュー POST で紙/ウォシュレット/おむつ台/営業時間/石けんを送ると reviews に入り、
--    非 null だけ review_facility_claims が pending。toilets の当該列は変わらない。
-- ② null や「ここトイレない」では claim ができない。名前・メール・電話の列は無い。
-- ③ 承認で toilets 列が変わり admin_edits に source_review_id 付きで追記される。source は osm のまま。
-- ④ 却下では toilets も admin_edits も増えない。
-- ⑤ pending 申請の承認で toilets.source='user' の新規行ができ、submission は approved。
-- ⑥ 却下した申請は toilets に現れない。30m 以内に既存トイレがあると承認は例外で pending のまま。
-- ⑦ 別 IP の confirm が 3 件の自動昇格(submit_toilet)は従来どおり動く。
-- ⑧ 既存 /api/toilets と手動 PATCH /api/admin/toilets/[id] が壊れていない。
