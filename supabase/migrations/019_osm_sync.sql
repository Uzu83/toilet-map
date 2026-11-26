-- 019_osm_sync.sql — 週次 OSM 同期のカーソル、実行ログ、保護付き upsert
-- 実行: Supabase ダッシュボード SQL Editor に貼って Run（または supabase db push）。冪等。
-- ⚠️ 本番にはこのファイルを追加しただけでは適用されない。オーナーが手動適用する。
--    main は merge で自動デプロイされる。適用より先に merge すると /api/cron/osm-sync だけ失敗する
--    （地図・既存 API はこの関数を呼ばない）。
--
-- データ保護（src/lib/osmSync/policy.ts と同じ規則。この関数が最終防壁）:
--   1. 衝突キーは osm_id。無ければ insert、あれば update。
--   2. source='user' の行は一切更新しない。
--   3. 値が null（OSM にタグが無い）の列は既存値を上書きしない。
--   4. admin_edits.changed_fields にある列は editor が admin でも ai でも上書きしない。
--   5. source は insert のときだけ osm / inferred。update では変えない。
--   6. toilets の行は消さない。全件削除して入れ直す処理は無い。
--
-- ログ（osm_sync_runs / osm_sync_state）に個人情報も秘密も置かない。
-- カーソルは都道府県番号とタイルだけ。実行ログは件数と県コードと短いエラー文だけ。

-- ───────────────────────────────────────────────────────────────────
-- (1) 再開点（1 行）と実行ログ
-- ───────────────────────────────────────────────────────────────────
create table if not exists osm_sync_state (
  id smallint primary key default 1 check (id = 1),
  cursor jsonb not null,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

insert into osm_sync_state (id, cursor)
values (
  1,
  '{"v":1,"prefectureIndex":0,"tiles":null,"consecutiveFailures":0}'::jsonb
)
on conflict (id) do nothing;

create table if not exists osm_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'ok', 'partial', 'error')),
  cursor_before jsonb not null,
  cursor_after jsonb,
  queries int not null default 0,
  fetched int not null default 0,
  inserted int not null default 0,
  updated int not null default 0,
  skipped_user int not null default 0,
  skipped_protected int not null default 0,
  unchanged int not null default 0,
  skipped_invalid int not null default 0,
  skipped_units int not null default 0,
  prefecture_codes text[] not null default '{}',
  error text,
  note text,
  constraint osm_sync_runs_error_len check (error is null or char_length(error) <= 500),
  constraint osm_sync_runs_note_len check (note is null or char_length(note) <= 500)
);

create index if not exists osm_sync_runs_started_idx on osm_sync_runs (started_at desc);

alter table osm_sync_state enable row level security;
alter table osm_sync_runs enable row level security;

revoke all on osm_sync_state from public, anon, authenticated;
revoke all on osm_sync_runs from public, anon, authenticated;
grant select, insert, update on osm_sync_state to service_role;
grant select, insert, update on osm_sync_runs to service_role;
-- ログと再開点は消さない。service_role の default privileges で付いた DELETE / TRUNCATE も外す。
revoke delete, truncate on osm_sync_state from service_role;
revoke delete, truncate on osm_sync_runs from service_role;

-- ───────────────────────────────────────────────────────────────────
-- (2) 排他取得。古い running は interrupted にしてからロックする。
-- ───────────────────────────────────────────────────────────────────
create or replace function osm_sync_claim(p_lease_seconds int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_lease int;
  v_cursor jsonb;
  v_run_id uuid;
begin
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 300 then
    v_lease := 90;
  else
    v_lease := p_lease_seconds;
  end if;

  insert into osm_sync_state (id, cursor)
  values (
    1,
    '{"v":1,"prefectureIndex":0,"tiles":null,"consecutiveFailures":0}'::jsonb
  )
  on conflict (id) do nothing;

  update osm_sync_runs
  set status = 'error',
      finished_at = now(),
      error = 'interrupted'
  where status = 'running'
    and started_at < now() - interval '10 minutes';

  update osm_sync_state as s
  set locked_until = now() + make_interval(secs => v_lease),
      updated_at = now()
  where s.id = 1
    and (s.locked_until is null or s.locked_until < now())
  returning s.cursor into v_cursor;

  if not found then
    return jsonb_build_object('acquired', false);
  end if;

  insert into osm_sync_runs (status, cursor_before)
  values ('running', coalesce(v_cursor, '{}'::jsonb))
  returning id into v_run_id;

  return jsonb_build_object(
    'acquired', true,
    'cursor', v_cursor,
    'run_id', v_run_id
  );
end;
$$;

create or replace function osm_sync_finish(
  p_run_id uuid,
  p_cursor jsonb,
  p_status text,
  p_counts jsonb,
  p_prefecture_codes text[],
  p_error text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_codes text[];
  v_counts jsonb := coalesce(p_counts, '{}'::jsonb);
begin
  if p_status not in ('ok', 'partial', 'error') then
    raise exception 'osm_sync_finish: bad status';
  end if;
  if p_cursor is null or jsonb_typeof(p_cursor) <> 'object' then
    raise exception 'osm_sync_finish: bad cursor';
  end if;

  select coalesce(array_agg(c), '{}'::text[])
    into v_codes
  from unnest(coalesce(p_prefecture_codes, '{}'::text[])) as c
  where c ~ '^JP-[0-9]{2}$';
  v_codes := coalesce(v_codes, '{}'::text[]);

  update osm_sync_state
  set cursor = p_cursor,
      locked_until = null,
      updated_at = now()
  where id = 1;

  update osm_sync_runs
  set status = p_status,
      finished_at = now(),
      cursor_after = p_cursor,
      queries = greatest(coalesce((v_counts->>'queries')::int, 0), 0),
      fetched = greatest(coalesce((v_counts->>'fetched')::int, 0), 0),
      inserted = greatest(coalesce((v_counts->>'inserted')::int, 0), 0),
      updated = greatest(coalesce((v_counts->>'updated')::int, 0), 0),
      skipped_user = greatest(coalesce((v_counts->>'skipped_user')::int, 0), 0),
      skipped_protected = greatest(coalesce((v_counts->>'skipped_protected')::int, 0), 0),
      unchanged = greatest(coalesce((v_counts->>'unchanged')::int, 0), 0),
      skipped_invalid = greatest(coalesce((v_counts->>'skipped_invalid')::int, 0), 0),
      skipped_units = greatest(coalesce((v_counts->>'skipped_units')::int, 0), 0),
      prefecture_codes = v_codes,
      error = case when p_error is null then null else left(p_error, 500) end,
      note = case when p_note is null then null else left(p_note, 500) end
  where id = p_run_id;
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (3) 既存行 + 保護列。jsonb で返す（PostgREST の 1000 行上限を踏まない）。
-- ───────────────────────────────────────────────────────────────────
create or replace function osm_sync_lookup(p_osm_ids jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_result jsonb;
begin
  if p_osm_ids is null or jsonb_typeof(p_osm_ids) <> 'array' then
    return '[]'::jsonb;
  end if;
  if jsonb_array_length(p_osm_ids) > 2000 then
    raise exception 'osm_sync_lookup: too many ids';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'osm_id', t.osm_id,
    'source', t.source,
    'name', t.name,
    'lat', st_y(t.location::geometry),
    'lng', st_x(t.location::geometry),
    'has_washlet', t.has_washlet,
    'has_paper', t.has_paper,
    'has_soap', t.has_soap,
    'has_diaper_table', t.has_diaper_table,
    'is_universal', t.is_universal,
    'inferred_access', t.inferred_access,
    'opening_hours', t.opening_hours,
    'protected', coalesce((
      select jsonb_agg(distinct f)
      from admin_edits e
      cross join lateral jsonb_array_elements_text(
        case
          when jsonb_typeof(e.changed_fields) = 'array' then e.changed_fields
          else '[]'::jsonb
        end
      ) as f
      where e.toilet_id = t.id
        and f in (
          'name', 'has_washlet', 'has_paper', 'has_soap', 'has_diaper_table',
          'is_universal', 'inferred_access', 'opening_hours', 'location'
        )
    ), '[]'::jsonb)
  )), '[]'::jsonb)
  into v_result
  from toilets t
  where t.osm_id in (
    select (value)::bigint
    from jsonb_array_elements_text(p_osm_ids) as value
    where value ~ '^[0-9]+$'
  );

  return v_result;
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (4) 保護付き適用。アプリが誤った payload を送っても user / null / 管理列は守る。
-- ───────────────────────────────────────────────────────────────────
create or replace function osm_sync_apply(p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_i int;
  v_op jsonb;
  v_set jsonb;
  v_osm_id bigint;
  v_id uuid;
  v_source text;
  v_protected text[];
  v_inserted int := 0;
  v_updated int := 0;
  v_skipped_user int := 0;
  v_skipped_protected int := 0;
  v_unchanged int := 0;
  v_skipped_invalid int := 0;
  v_changed boolean;
  v_src text;
  v_lat double precision;
  v_lng double precision;
  v_cur_name text;
  v_cur_washlet boolean;
  v_cur_paper boolean;
  v_cur_soap boolean;
  v_cur_diaper boolean;
  v_cur_universal boolean;
  v_cur_access access_level;
  v_cur_hours text;
  v_cur_lat double precision;
  v_cur_lng double precision;
  v_name text;
  v_washlet boolean;
  v_paper boolean;
  v_soap boolean;
  v_diaper boolean;
  v_universal boolean;
  v_access access_level;
  v_hours text;
  v_do_name boolean;
  v_do_washlet boolean;
  v_do_paper boolean;
  v_do_soap boolean;
  v_do_diaper boolean;
  v_do_universal boolean;
  v_do_access boolean;
  v_do_hours boolean;
  v_do_loc boolean;
  v_text text;
begin
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'osm_sync_apply: p_ops must be a json array';
  end if;
  if jsonb_array_length(p_ops) > 500 then
    raise exception 'osm_sync_apply: batch too large';
  end if;

  for v_i in 0 .. jsonb_array_length(p_ops) - 1 loop
    v_op := p_ops -> v_i;
    v_changed := false;
    v_do_name := false;
    v_do_washlet := false;
    v_do_paper := false;
    v_do_soap := false;
    v_do_diaper := false;
    v_do_universal := false;
    v_do_access := false;
    v_do_hours := false;
    v_do_loc := false;

    begin
      v_osm_id := (v_op->>'osm_id')::bigint;
    exception when others then
      v_osm_id := null;
    end;
    if v_osm_id is null or v_osm_id <= 0 then
      v_skipped_invalid := v_skipped_invalid + 1;
      continue;
    end if;

    select
      t.id, t.source, t.name, t.has_washlet, t.has_paper, t.has_soap,
      t.has_diaper_table, t.is_universal, t.inferred_access, t.opening_hours,
      st_y(t.location::geometry), st_x(t.location::geometry)
    into
      v_id, v_source, v_cur_name, v_cur_washlet, v_cur_paper, v_cur_soap,
      v_cur_diaper, v_cur_universal, v_cur_access, v_cur_hours,
      v_cur_lat, v_cur_lng
    from toilets t
    where t.osm_id = v_osm_id
    for update;

    if found and v_source = 'user' then
      v_skipped_user := v_skipped_user + 1;
      continue;
    end if;

    if v_op->>'op' = 'insert' and not found then
      v_src := v_op->>'source';
      if v_src is null or v_src not in ('osm', 'inferred') then
        v_skipped_invalid := v_skipped_invalid + 1;
        continue;
      end if;
      begin
        v_lat := (v_op->>'lat')::double precision;
        v_lng := (v_op->>'lng')::double precision;
      exception when others then
        v_lat := null;
        v_lng := null;
      end;
      if v_lat is null or v_lng is null
         or v_lat < -90 or v_lat > 90 or v_lng < -180 or v_lng > 180 then
        v_skipped_invalid := v_skipped_invalid + 1;
        continue;
      end if;

      v_text := nullif(btrim(v_op->>'name'), '');
      if v_text is not null and char_length(v_text) > 300 then
        v_text := null;
        v_skipped_invalid := v_skipped_invalid + 1;
      end if;
      v_name := v_text;

      v_text := nullif(btrim(v_op->>'opening_hours'), '');
      if v_text is not null and char_length(v_text) > 500 then
        v_text := null;
        v_skipped_invalid := v_skipped_invalid + 1;
      end if;
      v_hours := v_text;

      v_access := case
        when v_op->>'inferred_access' in ('open', 'ask', 'permission')
          then (v_op->>'inferred_access')::access_level
        else null
      end;

      begin
        insert into toilets (
          osm_id, name, location, has_washlet, has_paper, has_soap,
          has_diaper_table, is_universal, source, inferred_access, opening_hours
        ) values (
          v_osm_id,
          v_name,
          st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography,
          case when jsonb_typeof(v_op->'has_washlet') = 'boolean' then (v_op->>'has_washlet')::boolean else null end,
          case when jsonb_typeof(v_op->'has_paper') = 'boolean' then (v_op->>'has_paper')::boolean else null end,
          case when jsonb_typeof(v_op->'has_soap') = 'boolean' then (v_op->>'has_soap')::boolean else null end,
          case when jsonb_typeof(v_op->'has_diaper_table') = 'boolean' then (v_op->>'has_diaper_table')::boolean else null end,
          case when jsonb_typeof(v_op->'is_universal') = 'boolean' then (v_op->>'is_universal')::boolean else null end,
          v_src,
          v_access,
          v_hours
        );
        v_inserted := v_inserted + 1;
      exception
        when unique_violation then
          -- 競合した行が user なら触らない。それ以外もこの文では上書きせず、次の実行の lookup に任せる。
          if exists (select 1 from toilets where osm_id = v_osm_id and source = 'user') then
            v_skipped_user := v_skipped_user + 1;
          else
            v_unchanged := v_unchanged + 1;
          end if;
      end;
      continue;
    end if;

    if not found or v_op->>'op' <> 'update' then
      v_skipped_invalid := v_skipped_invalid + 1;
      continue;
    end if;

    v_protected := coalesce(array(
      select distinct f
      from admin_edits e
      cross join lateral jsonb_array_elements_text(
        case
          when jsonb_typeof(e.changed_fields) = 'array' then e.changed_fields
          else '[]'::jsonb
        end
      ) as f
      where e.toilet_id = v_id
        and f in (
          'name', 'has_washlet', 'has_paper', 'has_soap', 'has_diaper_table',
          'is_universal', 'inferred_access', 'opening_hours', 'location'
        )
    ), '{}');

    v_set := coalesce(v_op->'set', '{}'::jsonb);

    -- name。null / 空 / 長すぎは書かない。
    if v_set ? 'name' and jsonb_typeof(v_set->'name') = 'string' then
      v_text := nullif(btrim(v_set->>'name'), '');
      if v_text is null or char_length(v_text) > 300 then
        v_skipped_invalid := v_skipped_invalid + 1;
      elsif 'name' = any(v_protected) then
        v_skipped_protected := v_skipped_protected + 1;
      elsif v_text is distinct from v_cur_name then
        v_name := v_text;
        v_do_name := true;
        v_changed := true;
      end if;
    end if;

    if v_set ? 'has_washlet' and jsonb_typeof(v_set->'has_washlet') = 'boolean' then
      if 'has_washlet' = any(v_protected) then
        v_skipped_protected := v_skipped_protected + 1;
      elsif (v_set->>'has_washlet')::boolean is distinct from v_cur_washlet then
        v_washlet := (v_set->>'has_washlet')::boolean;
        v_do_washlet := true;
        v_changed := true;
      end if;
    end if;

    if v_set ? 'has_paper' and jsonb_typeof(v_set->'has_paper') = 'boolean' then
      if 'has_paper' = any(v_protected) then
        v_skipped_protected := v_skipped_protected + 1;
      elsif (v_set->>'has_paper')::boolean is distinct from v_cur_paper then
        v_paper := (v_set->>'has_paper')::boolean;
        v_do_paper := true;
        v_changed := true;
      end if;
    end if;

    if v_set ? 'has_soap' and jsonb_typeof(v_set->'has_soap') = 'boolean' then
      if 'has_soap' = any(v_protected) then
        v_skipped_protected := v_skipped_protected + 1;
      elsif (v_set->>'has_soap')::boolean is distinct from v_cur_soap then
        v_soap := (v_set->>'has_soap')::boolean;
        v_do_soap := true;
        v_changed := true;
      end if;
    end if;

    if v_set ? 'has_diaper_table' and jsonb_typeof(v_set->'has_diaper_table') = 'boolean' then
      if 'has_diaper_table' = any(v_protected) then
        v_skipped_protected := v_skipped_protected + 1;
      elsif (v_set->>'has_diaper_table')::boolean is distinct from v_cur_diaper then
        v_diaper := (v_set->>'has_diaper_table')::boolean;
        v_do_diaper := true;
        v_changed := true;
      end if;
    end if;

    if v_set ? 'is_universal' and jsonb_typeof(v_set->'is_universal') = 'boolean' then
      if 'is_universal' = any(v_protected) then
        v_skipped_protected := v_skipped_protected + 1;
      elsif (v_set->>'is_universal')::boolean is distinct from v_cur_universal then
        v_universal := (v_set->>'is_universal')::boolean;
        v_do_universal := true;
        v_changed := true;
      end if;
    end if;

    if v_set ? 'inferred_access' and jsonb_typeof(v_set->'inferred_access') = 'string'
       and v_set->>'inferred_access' in ('open', 'ask', 'permission') then
      if 'inferred_access' = any(v_protected) then
        v_skipped_protected := v_skipped_protected + 1;
      elsif (v_set->>'inferred_access')::access_level is distinct from v_cur_access then
        v_access := (v_set->>'inferred_access')::access_level;
        v_do_access := true;
        v_changed := true;
      end if;
    end if;

    if v_set ? 'opening_hours' and jsonb_typeof(v_set->'opening_hours') = 'string' then
      v_text := nullif(btrim(v_set->>'opening_hours'), '');
      if v_text is null or char_length(v_text) > 500 then
        v_skipped_invalid := v_skipped_invalid + 1;
      elsif 'opening_hours' = any(v_protected) then
        v_skipped_protected := v_skipped_protected + 1;
      elsif v_text is distinct from v_cur_hours then
        v_hours := v_text;
        v_do_hours := true;
        v_changed := true;
      end if;
    end if;

    if v_set ? 'lat' and v_set ? 'lng'
       and jsonb_typeof(v_set->'lat') = 'number'
       and jsonb_typeof(v_set->'lng') = 'number' then
      begin
        v_lat := (v_set->>'lat')::double precision;
        v_lng := (v_set->>'lng')::double precision;
      exception when others then
        v_lat := null;
        v_lng := null;
      end;
      if v_lat is null or v_lng is null
         or v_lat < -90 or v_lat > 90 or v_lng < -180 or v_lng > 180 then
        v_skipped_invalid := v_skipped_invalid + 1;
      elsif 'location' = any(v_protected) then
        v_skipped_protected := v_skipped_protected + 1;
      elsif v_cur_lat is null or v_cur_lng is null
         or abs(v_lat - v_cur_lat) > 0.00001
         or abs(v_lng - v_cur_lng) > 0.00001 then
        v_do_loc := true;
        v_changed := true;
      end if;
    end if;

    if not v_changed then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    -- OSM_SYNC_UPDATE_BEGIN
    -- 流入元の列は代入しない。空の入力も CASE の else で既存値のまま残す。
    update toilets as t
    set
      name = case when v_do_name then v_name else t.name end,
      has_washlet = case when v_do_washlet then v_washlet else t.has_washlet end,
      has_paper = case when v_do_paper then v_paper else t.has_paper end,
      has_soap = case when v_do_soap then v_soap else t.has_soap end,
      has_diaper_table = case when v_do_diaper then v_diaper else t.has_diaper_table end,
      is_universal = case when v_do_universal then v_universal else t.is_universal end,
      inferred_access = case when v_do_access then v_access else t.inferred_access end,
      opening_hours = case when v_do_hours then v_hours else t.opening_hours end,
      location = case
        when v_do_loc then st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography
        else t.location
      end
    where t.id = v_id;
    -- OSM_SYNC_UPDATE_END

    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped_user', v_skipped_user,
    'skipped_protected', v_skipped_protected,
    'unchanged', v_unchanged,
    'skipped_invalid', v_skipped_invalid
  );
end;
$$;

revoke all on function osm_sync_claim(int) from public;
revoke all on function osm_sync_claim(int) from anon, authenticated;
grant execute on function osm_sync_claim(int) to service_role;

revoke all on function osm_sync_finish(uuid, jsonb, text, jsonb, text[], text, text) from public;
revoke all on function osm_sync_finish(uuid, jsonb, text, jsonb, text[], text, text) from anon, authenticated;
grant execute on function osm_sync_finish(uuid, jsonb, text, jsonb, text[], text, text) to service_role;

revoke all on function osm_sync_lookup(jsonb) from public;
revoke all on function osm_sync_lookup(jsonb) from anon, authenticated;
grant execute on function osm_sync_lookup(jsonb) to service_role;

revoke all on function osm_sync_apply(jsonb) from public;
revoke all on function osm_sync_apply(jsonb) from anon, authenticated;
grant execute on function osm_sync_apply(jsonb) to service_role;
