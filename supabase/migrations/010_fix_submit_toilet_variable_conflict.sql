-- 010_fix_submit_toilet_variable_conflict.sql — Issue #2 follow-up(本番スモークで検出した修正)
-- 実行: Supabase ダッシュボード > SQL Editor で全文ペースト → Run。冪等(CREATE OR REPLACE)。008 の後。
--
-- 背景: 本番デプロイ後のスモークで POST /api/submissions が 500
--   `column reference "submission_id" is ambiguous`。
--   原因 = submit_toilet の RETURNS TABLE の OUT 列名(submission_id / confirm_count)が
--   `on conflict (submission_id, ip_hash)` 等のテーブル列名と衝突(plpgsql の変数/列名衝突)。
--   vitest は RPC をモックしていたため DB ロジックがすり抜けた。
-- 対策: 関数先頭に `#variable_conflict use_column`。実変数は全て v_/p_ 接頭辞で OUT 名と衝突せず、
--   曖昧な裸の識別子(on conflict の列など)は列として解決させるのが正。API の戻り値キーは不変。
-- 注: CREATE OR REPLACE は既存 ACL(008 の REVOKE/GRANT)を保持するが、自己完結のため末尾で再宣言する。

create or replace function submit_toilet(
  p_lat double precision,
  p_lng double precision,
  p_access access_level,
  p_ip_hash text,
  p_name text default null,
  p_is_outdoor boolean default null,
  p_is_universal boolean default null,
  p_comment text default null
)
returns table (
  result text,
  submission_id uuid,
  toilet_id uuid,
  confirm_count int
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_point geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  v_existing_toilet uuid;
  v_sub_id uuid;
  v_count int;
  v_inserted boolean;
  v_new_toilet uuid;
  v_cell constant double precision := 0.001;
  v_lat_pad constant double precision := 0.0005;
  v_lng_pad double precision;
  v_la int;
  v_lo int;
begin
  v_lng_pad := 0.0005 / greatest(cos(radians(p_lat)), 0.01);
  for v_la in floor((p_lat - v_lat_pad) / v_cell)::int .. floor((p_lat + v_lat_pad) / v_cell)::int loop
    for v_lo in floor((p_lng - v_lng_pad) / v_cell)::int .. floor((p_lng + v_lng_pad) / v_cell)::int loop
      perform pg_advisory_xact_lock(hashtext(v_la::text || ':' || v_lo::text)::bigint);
    end loop;
  end loop;

  if exists (
    select 1 from toilet_submissions s
    where st_dwithin(s.location, v_point, 30)
      and s.created_at > now() - interval '5 minutes'
  ) then
    return query select 'throttled'::text, null::uuid, null::uuid, null::int;
    return;
  end if;

  v_existing_toilet := nearby_toilet(p_lat, p_lng, 30);
  if v_existing_toilet is not null then
    return query select 'dup'::text, null::uuid, v_existing_toilet, null::int;
    return;
  end if;

  select s.id into v_sub_id
  from toilet_submissions s
  where s.status = 'pending'
    and st_dwithin(s.location, v_point, 30)
  order by st_distance(s.location, v_point) asc
  limit 1;

  if v_sub_id is null then
    insert into toilet_submissions (location, name, access_level, is_outdoor, is_universal, comment, ip_hash, confirm_count)
    values (v_point, p_name, p_access, p_is_outdoor, p_is_universal, p_comment, p_ip_hash, 1)
    returning id into v_sub_id;

    insert into submission_confirmations (submission_id, ip_hash)
    values (v_sub_id, p_ip_hash)
    on conflict (submission_id, ip_hash) do nothing;

    return query select 'pending'::text, v_sub_id, null::uuid, 1;
    return;
  end if;

  insert into submission_confirmations (submission_id, ip_hash)
  values (v_sub_id, p_ip_hash)
  on conflict (submission_id, ip_hash) do nothing;
  get diagnostics v_inserted = row_count;

  select count(*)::int into v_count
  from submission_confirmations c
  where c.submission_id = v_sub_id;

  update toilet_submissions set confirm_count = v_count where id = v_sub_id;

  if v_count >= 3 then
    insert into toilets (name, location, source, inferred_access, is_universal)
    select s.name, s.location, 'user', s.access_level, s.is_universal
    from toilet_submissions s
    where s.id = v_sub_id
    returning id into v_new_toilet;

    update toilet_submissions
    set status = 'approved', promoted_toilet_id = v_new_toilet
    where id = v_sub_id;

    return query select 'promoted'::text, v_sub_id, v_new_toilet, v_count;
    return;
  end if;

  return query select 'pending'::text, v_sub_id, null::uuid, v_count;
end;
$$;

revoke execute on function submit_toilet(double precision, double precision, access_level, text, text, boolean, boolean, text) from public;
revoke execute on function submit_toilet(double precision, double precision, access_level, text, text, boolean, boolean, text) from anon, authenticated;
grant execute on function submit_toilet(double precision, double precision, access_level, text, text, boolean, boolean, text) to service_role;
