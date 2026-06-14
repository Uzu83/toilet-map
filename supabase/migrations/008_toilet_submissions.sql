-- 008_toilet_submissions.sql — Phase 2: ユーザー投稿によるトイレ追加申請フロー(Issue #2)
-- 実行: Supabase ダッシュボード > SQL Editor で全文ペースト → Run(または supabase db push)。冪等。
-- ⚠️ デプロイ前に手動 apply が必要(005/006/007 と同様)。未適用のまま deploy すると
--    /api/submissions・pending ピン取得が未定義 RPC で 500 になる。適用順: 008 → 009 → smoke → コードデプロイ。
--
-- 設計(PROGRESS-2.md §タスク一覧 / Notion 設計書 §5・§8):
--  - 匿名投稿可。多層防御 4 層 = ①IP rate limit(in-memory, API 層) ②同一地点 5 分スロットル(DB 側, 本ファイル)
--    ③confirm は distinct ip_hash のみ加算(ledger + UNIQUE) ④not_a_toilet 自己修正(既存 003)。
--  - ハイブリッド承認: confirm_count >= 3 で自動承認(pending → toilets へ source='user' insert-only 昇格)。
--  - 確定閾値(task 1.3, 2026-06-14 人間承認): confirm_count>=3 / ST_DWithin=30m / 同地点スロットル 5 分 /
--    advisory lock バケット = 緯度経度を小数 3 桁(≈111m)に丸めたキー。
--  - 既存 OSM ピンは破壊しない(AC4): 昇格は INSERT のみ。既存 toilets 行を UPDATE/DELETE しない。
--
-- 新ファイル方針: 既存 001-007 は書き換えない。申請系は本 008 + SEO 述語拡張 009 に追加する。

-- ───────────────────────────────────────────────────────────────────
-- (1) 申請テーブル(task 2.1)
-- ───────────────────────────────────────────────────────────────────
-- access_level は user 投稿の希望色。昇格時は toilets.inferred_access に写す
-- (レビューが付けば dominant_access が優先する既存の effectiveAccess モデルを再利用)。
-- is_outdoor は toilets に対応カラムが無いため申請レコードのモデレーション文脈としてのみ保持(昇格時は写さない)。
create table if not exists toilet_submissions (
  id uuid primary key default gen_random_uuid(),
  location geography(point, 4326) not null,
  name text,
  access_level access_level not null,
  is_outdoor boolean,
  is_universal boolean,
  comment text check (length(coalesce(comment, '')) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  confirm_count int not null default 1,
  ip_hash text,
  promoted_toilet_id uuid references toilets(id) on delete set null,
  -- 運用フィールド(初期は Supabase dashboard から手動モデレーション)
  reviewed_by text,
  review_note text,
  rejected_reason text,
  created_at timestamptz not null default now()
);

create index if not exists toilet_submissions_location_idx on toilet_submissions using gist(location);
create index if not exists toilet_submissions_status_created_idx on toilet_submissions(status, created_at);

-- confirm の台帳(ledger)。confirm_count を「監査可能」にする(bare counter は水増し検知不能 / Codex #3)。
-- UNIQUE(submission_id, ip_hash) で同一 IP の二重 confirm を弾く(distinct-ip 加算)。
create table if not exists submission_confirmations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references toilet_submissions(id) on delete cascade,
  ip_hash text not null,
  created_at timestamptz not null default now(),
  unique (submission_id, ip_hash)
);

create index if not exists submission_confirmations_submission_idx on submission_confirmations(submission_id);

-- ───────────────────────────────────────────────────────────────────
-- (2) insert-only guard(task 2.2)
-- ───────────────────────────────────────────────────────────────────
-- ledger は追記専用。UPDATE/DELETE を trigger で禁止して不変条件化する。
-- security definer 経路でも RLS は bypass されるため、RLS ではなく trigger で担保する。
create or replace function forbid_ledger_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'submission_confirmations is append-only (% not allowed)', tg_op;
end;
$$;

drop trigger if exists submission_confirmations_no_mutation on submission_confirmations;
create trigger submission_confirmations_no_mutation
  before update or delete on submission_confirmations
  for each row execute function forbid_ledger_mutation();

-- 注: toilets への昇格 INSERT-only は submit_toilet RPC のロジックで担保する
--     (toilets は seed の osm_id upsert で UPDATE されるため、テーブル全体の UPDATE 禁止 trigger は張れない)。

-- ───────────────────────────────────────────────────────────────────
-- (3) 公開 RPC: pending を bbox で返す + dedup ヘルパ(task 2.3)
-- ───────────────────────────────────────────────────────────────────
-- 明示列のみ返す(ip_hash 等の個人データは返さない / Codex #8)。anon にテーブル直 select は開けない(RLS)。
create or replace function pending_submissions_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  result_limit int default 500
)
returns table (
  id uuid,
  lat double precision,
  lng double precision,
  name text,
  status text,
  confirm_count int,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    st_y(s.location::geometry) as lat,
    st_x(s.location::geometry) as lng,
    s.name,
    s.status,
    s.confirm_count,
    s.created_at
  from toilet_submissions s
  where s.status = 'pending'
    and s.location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
  order by s.created_at desc
  limit result_limit;
$$;

-- dedup ヘルパ: 指定座標の radius(m)以内に既存 toilets があればその id を返す(最近接 1 件)。
-- ⚠️ not_a_toilet_count>=5 で非表示(偽陽性)のトイレは dup 対象から除外する(toilets_in_bbox と同じ
--    可視性述語)。除外しないと、隠れた偽陽性の近くに本物を追加しようとした申請が永久に dup で弾かれる(Codex 2-a)。
create or replace function nearby_toilet(
  p_lat double precision,
  p_lng double precision,
  p_radius double precision default 30
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.id
  from toilets t
  left join toilet_stats s on s.id = t.id
  where coalesce(s.not_a_toilet_count, 0) < 5
    and st_dwithin(
      t.location,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      p_radius
    )
  order by st_distance(
    t.location,
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
  ) asc
  limit 1;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (4) submit_toilet: 単一トランザクションの申請受付 + アトミック昇格(task 2.4)
-- ───────────────────────────────────────────────────────────────────
-- 順序: ①座標バケット advisory lock(concurrent double-promotion 防止 / Codex #2)
--       →②同一地点 5 分スロットル(地点グローバル: IP に直交した第 2 の壁。confirm も 5 分間隔を強制)
--       →③既存 toilets と 30m 近接なら dup(pending 作らず既存へ誘導)
--       →④既存 pending と 30m 近接なら ledger に distinct-ip confirm 追加 + confirm_count 再計算、無ければ新規 pending
--       →⑤confirm_count >= 3 で toilets へ insert-only(source='user') 昇格 + status='approved'
-- 戻り値 result: 'throttled' | 'dup' | 'pending' | 'promoted'
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
declare
  v_point geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  v_existing_toilet uuid;
  v_sub_id uuid;
  v_count int;
  v_inserted boolean;
  v_new_toilet uuid;
  -- advisory lock 用グリッド。cell=0.001 度(≈111m)。pad はメートル等価で 30m radius をカバー。
  v_cell constant double precision := 0.001;
  v_lat_pad constant double precision := 0.0005; -- ≈55m(緯度方向の度数は一定)
  v_lng_pad double precision;                    -- 経度方向は緯度補正(高緯度で度数を拡大)
  v_la int;
  v_lo int;
begin
  -- ① 並行申請の直列化。単一の丸めバケットだと境界付近で 30m 以内でも別バケットに丸まり、
  --    別ロックを取得して両者が ST_DWithin pending チェックを通過 → pending 重複が起きうる(Codex 2-b)。
  --    そこで point±pad の bbox が触れる全セルをロックする。30m 以内の 2 点は互いの pad 範囲に
  --    入るため必ず最低 1 セルを共有し、確実に直列化される。取得順は (la,lo 昇順)で全 tx 共通=デッドロック無し。
  -- ⚠️ 経度 1 度の距離は cos(lat) で縮むため、固定 0.0005 度だと高緯度で 30m 未満になりロックを
  --    取りこぼす(Codex 3-b)。メートル等価になるよう緯度補正する(極付近は greatest でガード)。
  v_lng_pad := 0.0005 / greatest(cos(radians(p_lat)), 0.01);
  for v_la in floor((p_lat - v_lat_pad) / v_cell)::int .. floor((p_lat + v_lat_pad) / v_cell)::int loop
    for v_lo in floor((p_lng - v_lng_pad) / v_cell)::int .. floor((p_lng + v_lng_pad) / v_cell)::int loop
      perform pg_advisory_xact_lock(hashtext(v_la::text || ':' || v_lo::text)::bigint);
    end loop;
  end loop;

  -- ② 同一地点 5 分スロットル(地点グローバル / 全 status)。フラッディング遮断。
  if exists (
    select 1 from toilet_submissions s
    where st_dwithin(s.location, v_point, 30)
      and s.created_at > now() - interval '5 minutes'
  ) then
    return query select 'throttled'::text, null::uuid, null::uuid, null::int;
    return;
  end if;

  -- ③ 既存 toilets と 30m 近接なら重複。新規 pending を作らず既存へ誘導。
  v_existing_toilet := nearby_toilet(p_lat, p_lng, 30);
  if v_existing_toilet is not null then
    return query select 'dup'::text, null::uuid, v_existing_toilet, null::int;
    return;
  end if;

  -- ④ 既存 pending と 30m 近接なら confirm、無ければ新規 pending を作成。
  select s.id into v_sub_id
  from toilet_submissions s
  where s.status = 'pending'
    and st_dwithin(s.location, v_point, 30)
  order by st_distance(s.location, v_point) asc
  limit 1;

  if v_sub_id is null then
    -- 新規 pending(作成者を ledger に 1 件登録 = confirm_count 1)
    insert into toilet_submissions (location, name, access_level, is_outdoor, is_universal, comment, ip_hash, confirm_count)
    values (v_point, p_name, p_access, p_is_outdoor, p_is_universal, p_comment, p_ip_hash, 1)
    returning id into v_sub_id;

    insert into submission_confirmations (submission_id, ip_hash)
    values (v_sub_id, p_ip_hash)
    on conflict (submission_id, ip_hash) do nothing;

    return query select 'pending'::text, v_sub_id, null::uuid, 1;
    return;
  end if;

  -- 既存 pending への confirm。distinct ip のみ加算(UNIQUE 制約 + ON CONFLICT)。
  insert into submission_confirmations (submission_id, ip_hash)
  values (v_sub_id, p_ip_hash)
  on conflict (submission_id, ip_hash) do nothing;
  get diagnostics v_inserted = row_count;

  -- confirm_count は ledger の distinct ip 件数から再計算(監査整合)。
  select count(*)::int into v_count
  from submission_confirmations c
  where c.submission_id = v_sub_id;

  update toilet_submissions set confirm_count = v_count where id = v_sub_id;

  -- ⑤ 閾値到達で昇格(insert-only)。
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

-- ───────────────────────────────────────────────────────────────────
-- (5) RLS + GRANT
-- ───────────────────────────────────────────────────────────────────
-- 直接 select/insert は anon に開けない。読みは pending_submissions_in_bbox(security definer, 明示列のみ)経由、
-- 書きは submit_toilet(security definer)経由のみ。RLS 有効 + ポリシー無し = 非 bypass ロールは全拒否。
alter table toilet_submissions enable row level security;
alter table submission_confirmations enable row level security;

grant select, insert, update, delete on toilet_submissions to service_role;
grant select, insert on submission_confirmations to service_role;

grant execute on function pending_submissions_in_bbox(double precision, double precision, double precision, double precision, int) to anon, authenticated, service_role;
grant execute on function nearby_toilet(double precision, double precision, double precision) to anon, authenticated, service_role;

-- submit_toilet は API ルート(secret key = service_role)からのみ呼ぶ。
-- ⚠️ PostgreSQL は新規 function の EXECUTE を既定で PUBLIC に付与する。GRANT だけでは
--    anon/authenticated も呼べてしまい(Supabase は anon key で RPC 直叩き可)、API の
--    バリデーション/rate limit を迂回し任意の p_ip_hash で confirm 水増し・自動昇格できる。
--    まず PUBLIC から剥がしてから service_role のみに付与する(Codex P1)。
revoke execute on function submit_toilet(double precision, double precision, access_level, text, text, boolean, boolean, text) from public;
revoke execute on function submit_toilet(double precision, double precision, access_level, text, text, boolean, boolean, text) from anon, authenticated;
grant execute on function submit_toilet(double precision, double precision, access_level, text, text, boolean, boolean, text) to service_role;
