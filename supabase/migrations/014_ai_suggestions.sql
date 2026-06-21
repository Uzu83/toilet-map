-- 014_ai_suggestions.sql — Phase B(B1): AI コメント分析 → 承認キュー(ai_suggestions)+ アトミック反映 RPC
-- 実行: Supabase ダッシュボード > SQL Editor で全文ペースト → Run(または supabase db push)。冪等。
--
-- ⚠️⚠️ デプロイ前に「手動 apply + live smoke」が必須(005-013 と同様、main 自動デプロイ OFF)。
--   適用順: 014 を apply → live smoke → コードデプロイ。順序を誤ると(コード先行デプロイ)
--   POST /api/admin/analyze・POST /api/admin/suggestions/[id] が ai_suggestions/RPC 不在で 500 になる。
--   ⚠️ plpgsql 本体ロジック(FOR UPDATE 行ロック・bool3 強制・admin_apply_edit 内呼び・単一 tx・409 不変条件)は
--      vitest モックでは検証できない(MEMORY: DB RPC live smoke / submit_toilet の列衝突を本番 500 で踏んだ教訓)。
--      本番/staging の実 DB スモークが唯一の検証手段。smoke 項目は末尾「LIVE SMOKE チェックリスト」を参照。
--
-- 新ファイル方針: 既存 001-013 は書き換えない。Phase B のキュー + RPC は本 014 に独立して足す。
-- 既知の罠 High①②③(Codex 異モデルレビューで合意、PHASE-B-DESIGN-BRIEF.md「Codex 合意・設計修正」)を
-- 後任 AI が踏まないよう、各所に WHY を厚く残す。
--
-- ═══════════════════════════════════════════════════════════════════════
-- High①: admin_apply_edit の引数追加は「migration 罠」(関数オーバーロードの落とし穴)
-- ═══════════════════════════════════════════════════════════════════════
-- 本 014 は admin_apply_edit に第 4 引数 p_source_review_id uuid default null を足す。だが PostgreSQL の
-- 関数はシグネチャ(引数型の並び)でオーバーロード解決されるため、4 引数版を CREATE OR REPLACE しても
-- 既存の 3 引数版 admin_apply_edit(uuid, text, jsonb) は「別の関数」として残り続ける。
--   → route.ts:126-130 の named-arg 呼び出し(p_toilet_id/p_editor/p_patch の 3 個)は、両方が存在すると
--     「3 個の引数にマッチする 3 引数版」に解決され、source_review_id が常に null のまま(=新機能が無効)になる。
--     最悪「曖昧(ambiguous)」エラーで本番 500 になりうる。
--   → 対策: 旧 3 引数版を明示 DROP してから 4 引数版だけを作る。これで route の 3 named-arg 呼び出しは
--     「default を持つ 4 引数版」に一意解決され(p_source_review_id は default null で補完)route 変更不要。
--   ⚠️ 後任 AI へ: 既存 RPC に引数を足すときは「CREATE OR REPLACE で上書きできる」と思い込まないこと。
--      引数の型並びが変わる = 別関数。古いシグネチャを DROP しないと両方残って呼び出しが旧版に解決される。
--
-- ═══════════════════════════════════════════════════════════════════════
-- High②: 手動 approve も自動反映も「単一 RPC / 単一トランザクション」(ai_apply_suggestion)
-- ═══════════════════════════════════════════════════════════════════════
-- 提案の反映を「アプリ層で ai_suggestions を status UPDATE → 別途 admin_apply_edit を呼ぶ」の 2 クエリにすると、
-- 012 が潰した TOCTOU/部分適用(status だけ進んで反映が失敗、または反映だけ済んで status が pending のまま)が
-- 再発する。→ ai_apply_suggestion(p_suggestion_id, p_actor, p_mode, p_threshold) を作り、
--   ①suggestion 行を FOR UPDATE でロック → ②pending 検証(でなければ例外=409 相当)→
--   ③admin_apply_edit(... p_source_review_id=該当 review_id) を内部呼び → ④ai_suggestions の status/
--     applied_edit_seq/reviewed_at を更新、までを単一トランザクションに閉じる。
--   B1 は manual のみ呼ぶ(自動反映 auto は B2)。両モードを同一 RPC に通すことで反映パスを一本化する。
--
-- ═══════════════════════════════════════════════════════════════════════
-- High③: 自動反映の「bool 3 列限定」を DB 層で強制(アプリの env だけに依存しない)
-- ═══════════════════════════════════════════════════════════════════════
-- 既存 allowlist(validateEdit / admin_apply_edit)は 6 列を許すので「最終防壁」と言うだけでは、auto 経路で
-- inferred_access / opening_hours も通ってしまう(オーナー決定「access/opening_hours は承認キュー固定」に反する)。
--   → ai_apply_suggestion の p_mode='auto' 分岐で、DB 側でも
--       field in ('has_washlet','has_diaper_table','is_universal')
--       かつ jsonb_typeof(value)='boolean'
--       かつ confidence >= p_threshold
--     を検証し、満たさなければ例外。tunable な閾値はアプリの env(AI_AUTO_APPLY_THRESHOLD)から渡すが、
--     「bool3 + boolean + 閾値」という構造ガードは DB に固定する(env 改変や呼び出しミスで access が自動反映されない)。
--   p_mode='manual'(人が承認)は標準 6 列 allowlist を許す(access/opening_hours はこの手動経路でのみ反映)。

-- ───────────────────────────────────────────────────────────────────
-- (1) ai_suggestions — AI 抽出提案の承認キュー(可変 status)
-- ───────────────────────────────────────────────────────────────────
-- WHY 可変 status(008 toilet_submissions 流の status text CHECK)にして 011 の append-only trigger を流用しない:
--   提案は pending → approved/rejected/auto_applied/no_op と「状態遷移」する。append-only にすると遷移を
--   別行で表現せざるを得ず煩雑。不変な監査は既存 admin_edits に一本化済み(反映は必ず admin_edits に記録)。
--   このテーブルは「AI が何を提案し、人/自動がどう処理したか」のワークキューであって監査原本ではない。
--
-- 列の WHY:
--   seq bigint generated always as identity: 挿入順に厳密単調増加(タイ無し)。最新判定や安定ソートの根拠。
--     created_at は default now() でタイ非決定なので順序判定には使わない(表示専用)。011 の edit_seq と同思想。
--   toilet_id: 提案対象トイレ。FK は張らない(下記 review_id と同様、参照先削除で提案ワークキューを巻き込まない)。
--   review_id nullable・FK 無し: 提案の根拠コメント。レビューが将来削除されても提案/監査の追跡性を残すため FK 無し
--     (admin_edits.source_review_id と同じ流儀)。null 可(コメント由来でない将来の提案経路に備える)。
--   field text CHECK(EDITABLE 6 列): 適用先カラム。EDITABLE_FIELDS(adminAuth.ts)と一致。
--     ⚠️ not_a_toilet は含めない(編集可能カラムではない・reviews 集計シグナル)。AI が検出しても admin への
--        情報フラグ表示に留め、ここには積まない(field CHECK は EDITABLE 6 列のまま)。
--   value jsonb: field 型混在(name=text / inferred_access=enum文字列 / bool3=boolean / opening_hours=text)。
--     admin_apply_edit の p_patch と対称(jsonb で受けて RPC 側で型解釈)。
--   confidence real CHECK(0..1): LLM 自己申告の確信度。auto 反映の閾値判定に使う(manual では参考表示)。
--   evidence text: 反映根拠(原文の該当箇所)。auto 反映は「原文部分文字列」必須(アプリ層 isAutoApplyEligible)。
--   status: pending(初期)/ approved(人が承認して反映済)/ rejected(却下)/ auto_applied(自動反映済)/
--     no_op(分析したが現在値と同値=反映不要の終端マーカー)。後 4 つは終端(再分析でスキップ)。
--   applied_edit_seq bigint nullable: 反映したとき admin_edits.edit_seq を記録(どの監査行に対応するか）。
--   reviewed_by/review_note/rejected_reason text: 処理者・メモ・却下理由(運用記録)。
--   reviewed_at timestamptz: 処理時刻(Codex 懸念 D で採用)。pending のうちは null。
create table if not exists ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  -- 挿入順に厳密単調増加。最新/安定ソートの唯一の根拠(created_at はタイ非決定なので順序に使わない=表示専用)。
  seq bigint generated always as identity,
  toilet_id uuid not null,
  review_id uuid,
  -- EDITABLE_FIELDS(adminAuth.ts)と一致。not_a_toilet は編集カラムでないので含めない(情報フラグ表示のみ)。
  field text not null check (field in (
    'name', 'inferred_access', 'has_washlet', 'has_diaper_table', 'is_universal', 'opening_hours'
  )),
  value jsonb not null,
  confidence real check (confidence >= 0 and confidence <= 1),
  evidence text,
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected', 'auto_applied', 'no_op'
  )),
  applied_edit_seq bigint,
  reviewed_by text,
  review_note text,
  rejected_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────
-- (2) 二重反映防止 = 部分 UNIQUE INDEX(toilet_id, field) WHERE status='pending'
-- ───────────────────────────────────────────────────────────────────
-- WHY 部分 UNIQUE(toilet_id, field)WHERE status='pending'(008:46-52 パターン):
--   同一トイレの同一フィールドに対する「未処理(pending)の提案」は常に 1 件に保つ。これにより
--   POST /api/admin/analyze が ON CONFLICT DO NOTHING で「既に pending がある field は積まない」を実現でき、
--   キューに同じ提案が重複して並ぶのを防ぐ。
--   ★ WHERE status='pending' が肝: 終端(approved/rejected/auto_applied/no_op)になった過去提案は対象外なので、
--     「一度 reject した後に再分析で新たな pending を積み直す」が可能(部分 index なので終端行は一意制約に絡まない)。
--   ★ 元案 UNIQUE(review_id, field) を却下した理由: 別レビュー由来でも同一 toilet×field なら二重反映になりうる。
--     防ぎたいのは「同一トイレの同一列への未処理提案の重複」であって「同一レビューの重複」ではない(敵対検証済)。
create unique index if not exists ai_suggestions_pending_uq
  on ai_suggestions (toilet_id, field)
  where status = 'pending';

-- トイレ単位の提案履歴 + 「pending を新しい順に出す」ダッシュボード表示用。seq desc(挿入順の最新が先頭)。
create index if not exists ai_suggestions_toilet_seq_idx on ai_suggestions (toilet_id, seq desc);
-- 承認キュー(全トイレ横断の pending 一覧)表示用。status で絞って seq desc。
create index if not exists ai_suggestions_status_seq_idx on ai_suggestions (status, seq desc);

-- ───────────────────────────────────────────────────────────────────
-- (3) RLS + GRANT(最小権限 — 011/012 と同じ多層防御)
-- ───────────────────────────────────────────────────────────────────
-- 提案キューは運営専用。anon/authenticated には一切開けない(RLS 有効 + ポリシー無し = 非 bypass ロール全拒否)。
-- 書き込み/更新は service_role(secret key の admin API ルート)のみ。
-- WHY delete を grant しない: 提案は no-op/rejected で終端マーカーを残す設計(再分析の冪等スキップに使う)。
--   物理削除すると「AI が見たが処理した」履歴が消え、同一コメントを無限に再分析しうる。最小権限で delete を外す。
alter table ai_suggestions enable row level security;

grant select, insert, update on ai_suggestions to service_role;

-- ───────────────────────────────────────────────────────────────────
-- (4) admin_apply_edit を 4 引数版へ(High①: 旧 3 引数版を明示 DROP してから作り直す)
-- ───────────────────────────────────────────────────────────────────
-- ⚠️ High① の核心: まず旧 3 引数版を DROP する。これをしないと両シグネチャが共存し、route の 3 named-arg
--    呼び出しが旧版に解決されて source_review_id が入らない(または ambiguous で 500)。
--    DROP 対象の正確な型並びは (uuid, text, jsonb)(013:84-88 / 013:244-246 の GRANT と一致)。
-- ⚠️ 依存(GRANT/呼び出し)があるので CASCADE は使わない。DROP → 直後に CREATE で同名 4 引数版を作るので
--    route からの参照は再作成後に解決される(本 migration は単一トランザクションで適用される想定)。
drop function if exists admin_apply_edit(uuid, text, jsonb);

-- admin_apply_edit(4 引数版)— 013 の本体ロジックを「完全踏襲」し、INSERT の source_review_id だけを
--   ハードコード null から p_source_review_id に差し替える。それ以外(FOR UPDATE 行ロック / 列 allowlist /
--   array_append / #variable_conflict use_column / security definer / set search_path / no-op 冪等 /
--   admin_edits 同一 tx INSERT)は 013 と同一。
--
-- ⚠️ 013 からの差分は「①引数に p_source_review_id 追加 ②INSERT の source_review_id 列に p_source_review_id を渡す」
--    の 2 点だけ。本体の不変条件(下記)は 013 のコメントと同じなので、ここでは要点のみ再掲し詳細は 012/013 を参照。
--    - security definer + set search_path = public: 監査 RPC だけが toilets を変更できる前提 + search_path 注入封じ。両方不変。
--    - FOR UPDATE: SELECT(before)→UPDATE の間の lost update(TOCTOU)を直列化で防ぐ。消すと再発。
--    - array_append: text[] への要素追加。`|| 'リテラル'` は malformed array literal で落ちる(013 の本番 500 教訓)。
--    - #variable_conflict use_column: 裸の識別子を「列」として解決(010 の column ambiguous 教訓)。
create or replace function admin_apply_edit(
  p_toilet_id uuid,
  p_editor text,
  p_patch jsonb,
  p_source_review_id uuid default null  -- 013 では INSERT に null ハードコードだった根拠レビュー。default null で route(3 引数呼び)非破壊。
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_current toilets%rowtype;   -- FOR UPDATE でロックした現在行(before の取得元)
  v_changed text[] := '{}';    -- 実際に値が変わった列名(no-op 列は載せない)
  v_before jsonb := '{}'::jsonb;
  v_after  jsonb := '{}'::jsonb;
  v_edit_id uuid;
  v_name text;
  v_inferred_access text;
  v_has_washlet boolean;
  v_has_diaper_table boolean;
  v_is_universal boolean;
  v_opening_hours text;
begin
  -- editor は 'admin' / 'ai' のみ(admin_edits.editor CHECK と一致)。それ以外は呼び出し側のバグ。
  if p_editor not in ('admin', 'ai') then
    raise exception 'admin_rpc: invalid editor';
  end if;

  -- ★TOCTOU 解消の核心: 対象行を FOR UPDATE で行ロック(013:119-123 と同一)。消すと lost update が再発。
  select * into v_current from toilets where id = p_toilet_id for update;
  if not found then
    raise exception 'admin_rpc: toilet not found';
  end if;

  -- 列ホワイトリスト(DB 層・多層防御)。p_patch から既知キーだけを ? で読む。未知キーは無視(改ざん面の最小化)。
  -- 許可列: name / inferred_access / has_washlet / has_diaper_table / is_universal / opening_hours(EDITABLE_FIELDS と一致)。

  if p_patch ? 'name' then
    v_name := p_patch->>'name';
    if v_current.name is distinct from v_name then
      v_changed := array_append(v_changed, 'name');  -- ⚠️ `|| 'name'` 不可(malformed array literal、013 の本番 500)
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

  -- no-op を UPDATE しない(冪等)。route は applied=false を 200 で返す。
  if array_length(v_changed, 1) is null then
    return jsonb_build_object('applied', false, 'edit_id', null, 'changed_fields', '[]'::jsonb);
  end if;

  -- 変化列のみ UPDATE(同一トランザクション)。source/dominant_access は touch しない(allowlist 外)。
  update toilets set
    name             = case when v_after ? 'name'             then v_name             else name end,
    inferred_access  = case when v_after ? 'inferred_access'  then v_inferred_access::access_level else inferred_access end,
    has_washlet      = case when v_after ? 'has_washlet'      then v_has_washlet      else has_washlet end,
    has_diaper_table = case when v_after ? 'has_diaper_table' then v_has_diaper_table else has_diaper_table end,
    is_universal     = case when v_after ? 'is_universal'     then v_is_universal     else is_universal end,
    opening_hours    = case when v_after ? 'opening_hours'    then v_opening_hours    else opening_hours end
  where id = p_toilet_id;

  -- 監査を同一 tx で INSERT。失敗すれば UPDATE ごとロールバック = 監査なしの変更が構造的に起こらない。
  -- ★013 との唯一の差分: source_review_id を null ハードコードでなく p_source_review_id にする
  --   (手動 PATCH は default null のまま、AI 経路は ai_apply_suggestion が review_id を渡す)。
  insert into admin_edits (toilet_id, editor, changed_fields, before, after, source_review_id)
  values (p_toilet_id, p_editor, to_jsonb(v_changed), v_before, v_after, p_source_review_id)
  returning id into v_edit_id;

  return jsonb_build_object('applied', true, 'edit_id', v_edit_id, 'changed_fields', to_jsonb(v_changed));
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (5) ai_apply_suggestion — 提案の反映 + status 更新を「単一トランザクション」で(High②③)
-- ───────────────────────────────────────────────────────────────────
-- 引数:
--   p_suggestion_id : 反映する ai_suggestions 行
--   p_actor         : admin_apply_edit に渡す editor。'admin'(手動承認)/ 'ai'(自動反映)。それ以外は例外。
--   p_mode          : 'manual'(人が承認 = 6 列 allowlist 許可)/ 'auto'(自動反映 = bool3 限定の DB ガード)。
--   p_threshold     : auto のときの confidence 閾値(アプリの env AI_AUTO_APPLY_THRESHOLD を渡す)。manual では未使用。
-- 戻り値 jsonb:
--   { "applied": bool, "status": text, "edit_id": uuid|null, "changed_fields": text[] }
--   applied=false は no-op(現在値と同値)。このとき ai_suggestions.status='no_op' に遷移して終端化する。
-- エラー(route が HTTP を出し分けられる判別可能メッセージ):
--   'admin_rpc: suggestion not found'        → route 404
--   'admin_rpc: suggestion not pending'      → route 409(既に処理済 = 二重反映防止)
--   'admin_rpc: invalid mode'                → route 500(呼び出し側バグ)
--   'admin_rpc: auto field not allowed'      → route 422/400 相当(bool3 以外を auto 反映しようとした)
--   'admin_rpc: auto value not boolean'      → 同上(value が boolean でない)
--   'admin_rpc: auto confidence too low'     → 同上(confidence < 閾値)
--   + admin_apply_edit が raise するもの(toilet not found / invalid inferred_access 等)もそのまま伝播。
--
-- ⚠️ 不変条件(012/013 踏襲・外さない):
--   - security definer + set search_path = public: 高権限実行 + search_path 注入封じ。
--   - #variable_conflict use_column: 裸識別子を列に解決(本関数は ai_suggestions 列を直接書く)。
--   - FOR UPDATE: suggestion 行をロックし「pending 検証 → 反映 → status 更新」を直列化(二重反映/競合の窓を消す)。
--   - admin_apply_edit を内部呼びすることで、反映本体ロジック(toilets UPDATE + admin_edits INSERT)を
--     1 箇所に集約する(High②の保守性 = array_append 修正のような変更を 2 箇所に書かない)。
create or replace function ai_apply_suggestion(
  p_suggestion_id uuid,
  p_actor text,
  p_mode text,
  p_threshold real default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_sugg ai_suggestions%rowtype;
  v_patch jsonb;
  v_apply jsonb;       -- admin_apply_edit の戻り
  v_applied boolean;
  v_edit_id uuid;
  v_edit_seq bigint;
  v_changed jsonb;
  v_new_status text;
  v_reviewed_by text;  -- 処理者ラベル(reviewed_by 用)。p_actor=反映値の出所とは別概念(下記 WHY)。
begin
  if p_actor not in ('admin', 'ai') then
    raise exception 'admin_rpc: invalid editor';  -- admin_apply_edit と同じ語彙(route のマッピングと整合)
  end if;
  if p_mode not in ('manual', 'auto') then
    raise exception 'admin_rpc: invalid mode';
  end if;

  -- ───────────────────────────────────────────────────────────────
  -- editor(p_actor)と reviewed_by(処理者)を分離する(意味割れの解消)
  -- ───────────────────────────────────────────────────────────────
  -- WHY 2 つの概念を混同しない(Claude reviewer M1 + Codex 両者 medium で合意):
  --   - admin_apply_edit に渡す editor (= p_actor) = 「admin_edits.editor = 反映された値の“出所”」。
  --     AI が抽出した提案を反映するのだから出所は常に 'ai' が正しい(承認操作を人が押しても、
  --     その値の出どころは LLM 抽出)。よって p_actor は呼び出し側で 'ai' を渡し、ここでは変えない。
  --   - ai_suggestions.reviewed_by = 「この提案を“処理した主体”(誰が承認/却下/自動反映したか)」。
  --     これは出所(ai)とは別軸。manual(人が承認ボタンを押した)なら処理者は admin、
  --     auto(無人の自動反映)なら処理者は ai。p_actor をそのまま入れると manual でも 'ai' になり、
  --     「誰が処理したか」が「値の出所」に上書きされて運用記録として読めなくなる(意味割れ)。
  --   B1 は env 共有パスワードの単独 admin で個人識別が無い → 処理者ラベルは 'admin' 固定で十分。
  --     将来 Supabase Auth(Phase 3)で実ユーザを記録する余地はここを拡張すれば足りる(出所 ai は不変)。
  v_reviewed_by := case when p_mode = 'manual' then 'admin' else 'ai' end;

  -- ★FOR UPDATE で suggestion 行をロック。以降の pending 検証 → 反映 → status 更新が直列化され、
  --   同じ提案を 2 つのリクエストが同時に反映する二重適用を構造的に防ぐ。
  select * into v_sugg from ai_suggestions where id = p_suggestion_id for update;
  if not found then
    raise exception 'admin_rpc: suggestion not found';
  end if;

  -- 既に終端(approved/rejected/auto_applied/no_op)なら何もしない = 二重反映防止(409 相当)。
  if v_sugg.status <> 'pending' then
    raise exception 'admin_rpc: suggestion not pending';
  end if;

  -- ───────────────────────────────────────────────────────────────
  -- High③: auto 反映は DB 層で「bool3 + boolean + 閾値」を強制する
  -- ───────────────────────────────────────────────────────────────
  -- WHY DB でも強制: アプリの env(閾値)や呼び出しミスに依存せず、access/opening_hours/name が auto で
  --   反映されないことを構造的に保証する(オーナー決定「access 等は承認キュー固定」を DB 不変条件にする)。
  --   manual(人が承認)は標準 6 列 allowlist を admin_apply_edit 側で許す(ここでは追加制約を課さない)。
  if p_mode = 'auto' then
    if v_sugg.field not in ('has_washlet', 'has_diaper_table', 'is_universal') then
      raise exception 'admin_rpc: auto field not allowed';
    end if;
    if jsonb_typeof(v_sugg.value) <> 'boolean' then
      raise exception 'admin_rpc: auto value not boolean';
    end if;
    -- p_threshold が null(未指定)なら安全側で拒否(auto は必ず閾値を渡す約束)。
    if p_threshold is null or v_sugg.confidence is null or v_sugg.confidence < p_threshold then
      raise exception 'admin_rpc: auto confidence too low';
    end if;
  end if;

  -- 提案を admin_apply_edit の p_patch 形({field: value})に組む。value は jsonb のまま渡す
  --   (admin_apply_edit が field 別に ->> / ::boolean で型解釈する = p_patch と対称)。
  v_patch := jsonb_build_object(v_sugg.field, v_sugg.value);

  -- ★反映本体は admin_apply_edit に委譲(同一トランザクション内の関数呼び出し)。
  --   source_review_id にこの提案の review_id を渡す(High① の 4 引数版が要る理由 = AI 反映の出所を監査に残す)。
  v_apply := admin_apply_edit(v_sugg.toilet_id, p_actor, v_patch, v_sugg.review_id);
  v_applied := coalesce((v_apply->>'applied')::boolean, false);
  v_changed := coalesce(v_apply->'changed_fields', '[]'::jsonb);

  if v_applied then
    -- 実反映あり: admin_edits に追記された edit の id/seq を引いて applied_edit_seq に記録する。
    --   admin_apply_edit は edit_id を返すので、その行の edit_seq を取得(seq は同一 tx で採番済み)。
    v_edit_id := (v_apply->>'edit_id')::uuid;
    select edit_seq into v_edit_seq from admin_edits where id = v_edit_id;
    -- status は mode で出し分け: manual=approved(人が承認して反映)/ auto=auto_applied(自動反映)。
    v_new_status := case when p_mode = 'auto' then 'auto_applied' else 'approved' end;
    update ai_suggestions set
      status = v_new_status,
      applied_edit_seq = v_edit_seq,
      reviewed_by = v_reviewed_by,  -- 処理者(manual=admin / auto=ai)。出所(p_actor='ai')とは別軸。
      reviewed_at = now()
    where id = p_suggestion_id;
  else
    -- no-op(現在値と同値): toilets/admin_edits は変わらない(admin_apply_edit が applied=false を返した)。
    --   提案は 'no_op' に終端化して再分析の冪等スキップに使う(論点6 採用)。applied_edit_seq は null のまま。
    v_new_status := 'no_op';
    update ai_suggestions set
      status = 'no_op',
      reviewed_by = v_reviewed_by,  -- 処理者(manual=admin / auto=ai)。出所(p_actor='ai')とは別軸。
      reviewed_at = now()
    where id = p_suggestion_id;
  end if;

  return jsonb_build_object(
    'applied', v_applied,
    'status', v_new_status,
    'edit_id', v_edit_id,
    'changed_fields', v_changed
  );
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (6) GRANT(service_role 限定 — 012/013 と同じ多層防御)
-- ───────────────────────────────────────────────────────────────────
-- ⚠️ PostgreSQL は新規 function の EXECUTE を既定で PUBLIC に付与する。GRANT だけでは anon/authenticated も
--    呼べてしまい(Supabase は anon key で RPC 直叩き可)、admin 認証/CSRF を迂回して反映できる。
--    まず PUBLIC/anon/authenticated から剥がしてから service_role のみに付与する。
-- ⚠️ admin_apply_edit は High① で DROP→再作成したので、4 引数版に対して権限を貼り直す(旧 3 引数版の権限は
--    DROP で消えている)。シグネチャは (uuid, text, jsonb, uuid)。
revoke execute on function admin_apply_edit(uuid, text, jsonb, uuid) from public;
revoke execute on function admin_apply_edit(uuid, text, jsonb, uuid) from anon, authenticated;
grant execute on function admin_apply_edit(uuid, text, jsonb, uuid) to service_role;

revoke execute on function ai_apply_suggestion(uuid, text, text, real) from public;
revoke execute on function ai_apply_suggestion(uuid, text, text, real) from anon, authenticated;
grant execute on function ai_apply_suggestion(uuid, text, text, real) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- LIVE SMOKE チェックリスト(コードデプロイ前に本番/staging で実施・モックでは検証不能)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ 本番適用は admin 無操作の時間帯に行う(High① の drop function → create の間に旧 3 引数版
--    admin_apply_edit が呼ばれる窓を避ける。手動 PATCH/承認が同時に走ると ambiguous/不在で 500 になりうる)。
-- ① High① 非破壊: 手動 PATCH /api/admin/toilets/[id](editor='admin')が従来どおり 200 + admin_edits 追記。
--    その admin_edits 行の source_review_id が null(手動経路は default null で 4 引数版にバインド)であること。
-- ② analyze: POST /api/admin/analyze に review_id を投げ、ai_suggestions に pending 行が積まれること
--    (同一 toilet×field の二重投入は ON CONFLICT DO NOTHING で 1 件に保たれること = 部分 UNIQUE INDEX)。
-- ③ manual approve: POST /api/admin/suggestions/[id]{action:approve} → ai_apply_suggestion(manual)経由で
--    toilets が更新 + admin_edits に追記され、その source_review_id が「提案の review_id」と一致すること。
--    ai_suggestions.status='approved' / applied_edit_seq に admin_edits.edit_seq が入ること。
-- ④ no-op: 現在値と同値の提案を approve → toilets/admin_edits 不変、status='no_op'、applied_edit_seq=null。
-- ⑤ 二重反映防止: ③で approved になった提案を再度 approve → 409(suggestion not pending)。
-- ⑥ reject: POST /api/admin/suggestions/[id]{action:reject} → toilets 不変、status='rejected' + reviewed_at +
--    rejected_reason 記録(reject は toilets を触らないので ai_apply_suggestion を呼ばない=専用 RPC 不要)。
-- ⑦ auto ガード(B1 では UI から呼ばないが DB 関数単体で確認推奨): ai_apply_suggestion(p_mode='auto')に
--    inferred_access/name の提案を渡すと 'auto field not allowed'、bool3 でも confidence<閾値なら
--    'auto confidence too low' で例外になること(High③の DB 強制)。
-- ⑧ 既存 /api/toilets(地図)が非破壊であること。
