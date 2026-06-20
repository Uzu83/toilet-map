-- 012_admin_edit_rpc.sql — Phase A: /admin 編集/取消を「単一トランザクションのアトミック RPC」に統合
-- 実行: Supabase ダッシュボード > SQL Editor で全文ペースト → Run(または supabase db push)。冪等(CREATE OR REPLACE)。
-- ⚠️ デプロイ前に手動 apply が必要(005/006/007/008/009/010/011 と同様)。適用順: 011(admin_edits)→ 012 → smoke → コードデプロイ。
--    未適用のまま deploy すると PATCH/DELETE /api/admin/toilets/[id] が admin_apply_edit/admin_undo_edit 不在で 500 になる。
-- ⚠️ live smoke 必須: plpgsql 本体ロジック(FOR UPDATE ロック・列衝突・409 不変条件)は vitest モックでは検証できない。
--    プロジェクト既知方針(MEMORY: DB RPC live smoke)= モックは plpgsql の列衝突や行ロックの欠落を見逃すため、本番/staging で実 DB スモークする。
--
-- ───────────────────────────────────────────────────────────────────
-- WHY この migration が要るか(Codex 異モデルレビュー指摘 critical+high の 3 件を「同根」で解消)
-- ───────────────────────────────────────────────────────────────────
-- 旧実装(src/app/api/admin/toilets/[id]/route.ts のアプリ層 read-modify-write)は、
--   ①before を SELECT → ②toilets を UPDATE → ③admin_edits に INSERT
-- を「別々のクエリ」で順に投げていた。これには 3 つの構造的欠陥があった:
--
--   (A) TOCTOU(critical): ①SELECT と ②UPDATE の間に別の PATCH が割り込むと、両者の before が
--       同じ古い値になり、後勝ちで一方の編集が黙って失われる(lost update)。取消(undo)も
--       「現在値==after か」を SELECT で確認 → 別クエリで UPDATE するため、確認と更新の窓で
--       後続編集が入ると、後続を巻き戻す/不整合に復元する競合が起きうる。
--   (B) 監査欠落(high): ②UPDATE が成功し ③INSERT が失敗すると「変更は適用されたが監査が無い」
--       状態が永続化する(route は 500 を返すが UPDATE はロールバックできない)。
--       = 監査なしのデータ変更が構造的に起こりうる。
--   (C) 非アトミック undo(high): undo の check→update が別クエリで、検証と適用の間に窓がある。
--
-- 解決: 編集も取消も「単一トランザクション内の plpgsql RPC」に閉じ込め、
--   - 対象 toilets 行を SELECT ... FOR UPDATE で行ロック(TOCTOU を直列化で解消) →
--   - 列ホワイトリストを DB 層にも固定(多層防御。アプリ層 validateEdit が漏れても DB が止める) →
--   - 変化列のみ UPDATE + 同一 tx で admin_edits に INSERT(どちらか失敗で全ロールバック = B/C を構造的に不可能化)。
--   既存の submit_toilet(008/010)の「単一トランザクション + #variable_conflict use_column」パターンを踏襲する。
--
-- ⚠️⚠️ 後任 AI への警告: この 2 関数を「アプリ層の read-modify-write に戻す」リファクタは絶対にしない。
--    SELECT→UPDATE→INSERT を別クエリに割ると上記 (A)(B)(C) の TOCTOU/監査欠落が再導入される。
--    編集と監査は必ず同一トランザクション(=この RPC)に閉じること。route 側は RPC を呼ぶだけにする。
--
-- ───────────────────────────────────────────────────────────────────
-- 決定: 「admin 編集の監査必須」は admin 編集パスに限定する(全 toilets UPDATE を監査必須にはしない)
-- ───────────────────────────────────────────────────────────────────
-- Codex 再レビュー R2[medium](部分反論=採らない、ただし明文化する):
--   指摘「service_role は toilets を直接 UPDATE できる(001:119 の grant insert,update,delete to service_role)。
--         RPC を経由しない将来コードは監査なしで toilets を変えられるので、『監査必須』を DB 不変条件に
--         強制できていない」。
--
--   判断(revoke しない):
--     service_role から toilets の UPDATE を revoke すると scripts/seed-osm.ts の
--       .upsert(batch, { onConflict: "osm_id" })  =  INSERT ... ON CONFLICT DO UPDATE
--     が壊れる(この upsert は 001:119 の update grant に依存)。シードは OSM の一括同期で、
--     本質的に「非監査の正当な書き込み」(数万件を osm_id で冪等 upsert する運用)。
--     よって「全 toilets UPDATE を監査必須」は DB 不変条件にできない(シードと両立しない)。
--
--   採る設計: 監査必須は「admin 編集パス」に限定し、そのパスを本 012 の admin_apply_edit /
--     admin_undo_edit に一本化する。admin による toilets 変更は必ずこの監査 RPC を通す(規律で担保)。
--
--   残存リスク(受容): service key を持つ将来コードは RPC を迂回して toilets を直接 .update() できてしまう。
--     これは「能動的な脆弱性」ではなく「規律で守る前提」(secret key は運営サーバ内のみ・公開面には出ない)。
--     後任 AI が誤って直接 .update() を書かないよう、admin route 側にも guard コメントを置いた
--     (src/app/api/admin/toilets/[id]/route.ts)。
--
--   将来のハードニング案(今はやらない): seed を「別ロール」または「別の seed 専用 RPC」に移せば、
--     service_role から toilets の UPDATE を revoke して『admin/seed 以外の経路で UPDATE 不可』を
--     DB 不変条件に昇格できる。シードの権限分離が前提条件になるため Phase A スコープ外。
--
-- Codex 再々レビュー R3[medium](精密化に合意=採用): UPDATE は seed upsert のため残すが DELETE は別問題。
--   コードベース全体に「toilets 行を削除する正当な経路」は無い(seed=upsert で insert/update のみ、
--   admin 編集/取消=UPDATE のみ、not_a_toilet=件数で非表示にするだけで行削除しない)。よって
--   service_role の toilets DELETE はシードを壊さず revoke できる純粋な最小権限ハードニング
--   (= service key を持つ将来コード/事故による toilet 行消失経路を1つ閉じる)。本ファイル末尾で revoke する。
--   ※ 経緯: 当方の「UPDATE revoke は seed を壊すので過剰」という反論を Codex が受諾し、非破壊の DELETE に
--     絞り込んだ合意の結果。対等な議論で「UPDATE は残す/DELETE は剥がす」に着地した。
--
-- 新ファイル方針: 既存 001-011 は書き換えない。アトミック編集 RPC は本 012 に独立して足す。

-- ───────────────────────────────────────────────────────────────────
-- (1) admin_apply_edit — allowlist 列だけをアトミックに UPDATE + 監査 INSERT
-- ───────────────────────────────────────────────────────────────────
-- 引数:
--   p_toilet_id : 対象トイレ
--   p_editor    : 'admin'(手動)/ 'ai'(Phase B のオンデマンド反映)。それ以外は例外(admin_edits.editor の CHECK と整合)。
--   p_patch     : 編集パッチ(jsonb)。allowlist 列のキーだけを読む。未知キー/source/dominant_access は「無視」する
--                 (アプリ層 validateEdit は未知キーを 400 で拒否するが、DB 層では「無視」= 二重防御。
--                  DB に未知キーが届いても改ざんに使えないことを保証する。両者の役割: app=早期拒否, db=最終遮断)。
-- 戻り値 jsonb:
--   { "applied": bool, "edit_id": uuid|null, "changed_fields": text[] }
--   applied=false かつ changed_fields=[] は no-op(現状と同値)。route は 200 で冪等に返す。
--
-- エラー(route が HTTP を出し分けられるよう、判別可能なメッセージで raise する):
--   'admin_rpc: toilet not found'    → route 404
--   'admin_rpc: invalid editor'      → route 500(呼び出し側のバグ。クライアント由来ではない)
--   'admin_rpc: invalid inferred_access' → route 400 相当だが app 層で先に弾く想定。DB は最終防壁。
--
-- ⚠️ `security definer` + `set search_path = public`(両方とも不変条件。片方でも外さない):
--   - security definer: 関数を「定義者(= postgres / 高権限ロール)の権限」で実行する。これにより本ファイル末尾で
--     service_role から toilets の DELETE を revoke しても、また将来 toilets の直接 grant をさらに絞っても、
--     この監査 RPC だけは toilets を UPDATE できる(= 「toilets の変更は監査 RPC 経由でしか起こせない」へ
--     寄せていく前提を壊さない)。呼び出し可能ロールは末尾 GRANT で service_role のみに固定している。
--   - set search_path = public: security definer 関数で search_path を固定しないと、呼び出し側が
--     `search_path` を細工して同名のニセ関数/テーブル(例: 別スキーマの toilets)を差し込み、高権限で
--     実行させる古典的な権限昇格(CVE 級の罠)を許す。public 固定でこの注入面を閉じる。Supabase/Postgres の
--     security definer 関数の定石。⚠️ これを外す/可変にすると security definer と組み合わさって危険なので消さない。
create or replace function admin_apply_edit(
  p_toilet_id uuid,
  p_editor text,
  p_patch jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
-- ⚠️ #variable_conflict use_column(010 の教訓): plpgsql は裸の識別子が「PL 変数」か「テーブル列」か
--    曖昧なとき既定で変数優先に解決する。本関数は UPDATE/INSERT で列名(name 等)を直接書くため、
--    曖昧な裸識別子は「列」として解決させるのが正。実 PL 変数は全て v_/p_ 接頭辞で列名と衝突させない。
--    これを外すと submit_toilet が踏んだ "column reference is ambiguous" を再発する。
#variable_conflict use_column
declare
  v_current toilets%rowtype;   -- FOR UPDATE でロックした現在行(before の取得元)
  v_changed text[] := '{}';    -- 実際に値が変わった列名(no-op 列は載せない)
  v_before jsonb := '{}'::jsonb;
  v_after  jsonb := '{}'::jsonb;
  v_edit_id uuid;
  -- patch から読む候補値(allowlist 列ごと)。jsonb から型付きで取り出す。
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

  -- ★TOCTOU 解消の核心: 対象行を FOR UPDATE で「行ロック」する。
  --   これにより、本 tx がコミット/ロールバックするまで他の admin_apply_edit/admin_undo_edit は
  --   同じ行で待たされ、SELECT(before)→UPDATE の間に別 PATCH が割り込む lost update を構造的に防ぐ。
  --   ⚠️ FOR UPDATE を消すと TOCTOU(lost update)が即再発する。並行 PATCH の直列化はこの 1 行が根拠。
  select * into v_current from toilets where id = p_toilet_id for update;
  if not found then
    -- 行が無ければ 404 相当。route がこのメッセージを見て 404 を返す。
    raise exception 'admin_rpc: toilet not found';
  end if;

  -- ───────────────────────────────────────────────────────────────
  -- 列ホワイトリストを DB 層にも固定(多層防御)
  -- ───────────────────────────────────────────────────────────────
  -- WHY DB 層にも allowlist を置く: アプリ層 validateEdit(adminAuth.ts)が未知キーを拒否しているが、
  --   それは「アプリを通った場合」の防御。将来このRPCが別経路(別 route / バッチ / Phase B の AI)から
  --   呼ばれても source/dominant_access/未知キーを書き換えられないよう、DB 側でも許可列を固定する。
  --   ここでは p_patch から「既知キーだけ」を ? 演算子で読む。それ以外のキーは一切参照しない=無視。
  -- 許可列: name / inferred_access / has_washlet / has_diaper_table / is_universal / opening_hours
  --   (EDITABLE_FIELDS と一致。source/dominant_access は意図的に含めない=改ざん面の最小化)。

  -- name(string か null)。
  if p_patch ? 'name' then
    v_name := p_patch->>'name';  -- ->> は jsonb null も SQL null になる(= 名前を消す編集を許容)
    if v_current.name is distinct from v_name then
      v_changed := v_changed || 'name';
      v_before := v_before || jsonb_build_object('name', to_jsonb(v_current.name));
      v_after  := v_after  || jsonb_build_object('name', to_jsonb(v_name));
    end if;
  end if;

  -- inferred_access(enum: open/ask/permission)。DB 層でも enum 検証する(最終防壁)。
  if p_patch ? 'inferred_access' then
    v_inferred_access := p_patch->>'inferred_access';
    if v_inferred_access is null or v_inferred_access not in ('open', 'ask', 'permission') then
      raise exception 'admin_rpc: invalid inferred_access';
    end if;
    if v_current.inferred_access::text is distinct from v_inferred_access then
      v_changed := v_changed || 'inferred_access';
      v_before := v_before || jsonb_build_object('inferred_access', to_jsonb(v_current.inferred_access::text));
      v_after  := v_after  || jsonb_build_object('inferred_access', to_jsonb(v_inferred_access));
    end if;
  end if;

  -- boolean 3 列(true/false/null=不明)。
  if p_patch ? 'has_washlet' then
    v_has_washlet := (p_patch->>'has_washlet')::boolean;  -- jsonb null → SQL null
    if v_current.has_washlet is distinct from v_has_washlet then
      v_changed := v_changed || 'has_washlet';
      v_before := v_before || jsonb_build_object('has_washlet', to_jsonb(v_current.has_washlet));
      v_after  := v_after  || jsonb_build_object('has_washlet', to_jsonb(v_has_washlet));
    end if;
  end if;

  if p_patch ? 'has_diaper_table' then
    v_has_diaper_table := (p_patch->>'has_diaper_table')::boolean;
    if v_current.has_diaper_table is distinct from v_has_diaper_table then
      v_changed := v_changed || 'has_diaper_table';
      v_before := v_before || jsonb_build_object('has_diaper_table', to_jsonb(v_current.has_diaper_table));
      v_after  := v_after  || jsonb_build_object('has_diaper_table', to_jsonb(v_has_diaper_table));
    end if;
  end if;

  if p_patch ? 'is_universal' then
    v_is_universal := (p_patch->>'is_universal')::boolean;
    if v_current.is_universal is distinct from v_is_universal then
      v_changed := v_changed || 'is_universal';
      v_before := v_before || jsonb_build_object('is_universal', to_jsonb(v_current.is_universal));
      v_after  := v_after  || jsonb_build_object('is_universal', to_jsonb(v_is_universal));
    end if;
  end if;

  -- opening_hours(string か null)。
  if p_patch ? 'opening_hours' then
    v_opening_hours := p_patch->>'opening_hours';
    if v_current.opening_hours is distinct from v_opening_hours then
      v_changed := v_changed || 'opening_hours';
      v_before := v_before || jsonb_build_object('opening_hours', to_jsonb(v_current.opening_hours));
      v_after  := v_after  || jsonb_build_object('opening_hours', to_jsonb(v_opening_hours));
    end if;
  end if;

  -- ───────────────────────────────────────────────────────────────
  -- no-op を UPDATE しない(冪等)
  -- ───────────────────────────────────────────────────────────────
  -- WHY: 変化が無ければ UPDATE も INSERT もしない。空 UPDATE は無意味に行バージョンを進め、
  --   「変化していない監査」を残してノイズになる。route は applied=false を受けて 200(no-op)で返す。
  if array_length(v_changed, 1) is null then
    return jsonb_build_object('applied', false, 'edit_id', null, 'changed_fields', '[]'::jsonb);
  end if;

  -- ───────────────────────────────────────────────────────────────
  -- 変化列のみ UPDATE(同一トランザクション)
  -- ───────────────────────────────────────────────────────────────
  -- WHY 全列ではなく変化列のみ更新するため、jsonb から COALESCE で「変化した列だけ」を上書きする。
  --   変化していない列は v_after に入っていないので現在値を維持する(v_current から戻す)。
  --   source/dominant_access はそもそも touch しない(allowlist 外=この UPDATE に現れない)。
  update toilets set
    name             = case when v_after ? 'name'             then v_name             else name end,
    inferred_access  = case when v_after ? 'inferred_access'  then v_inferred_access::access_level else inferred_access end,
    has_washlet      = case when v_after ? 'has_washlet'      then v_has_washlet      else has_washlet end,
    has_diaper_table = case when v_after ? 'has_diaper_table' then v_has_diaper_table else has_diaper_table end,
    is_universal     = case when v_after ? 'is_universal'     then v_is_universal     else is_universal end,
    opening_hours    = case when v_after ? 'opening_hours'    then v_opening_hours    else opening_hours end
  where id = p_toilet_id;

  -- 監査を「同一トランザクションで」INSERT。ここが失敗すれば UPDATE も丸ごとロールバックされる
  --   = 監査なしのデータ変更が構造的に起こり得ない(Codex high 指摘 (B) の解消点)。
  insert into admin_edits (toilet_id, editor, changed_fields, before, after, source_review_id)
  values (p_toilet_id, p_editor, to_jsonb(v_changed), v_before, v_after, null)
  returning id into v_edit_id;

  return jsonb_build_object('applied', true, 'edit_id', v_edit_id, 'changed_fields', to_jsonb(v_changed));
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (2) admin_undo_edit — 直近の編集を「アトミックに取消」(append-only)
-- ───────────────────────────────────────────────────────────────────
-- 取消ポリシー(設計書 R1#5): 古い edit を無条件に before へ戻すと、その後の編集まで巻き戻す。
--   よって「そのトイレの最新 edit」かつ「現在値が after と一致(=後続編集が無い)」場合だけ before に復元する。
--   取消自体も admin_edits に追記する(append-only / 履歴を消さない)。1 段 undo のみ(redo/連続巻き戻しは作らない=過剰実装回避)。
--
-- 旧実装の窓(C): 「最新 edit 取得」「現在値==after か確認」「UPDATE」が別クエリで、検証と適用の間に
--   後続編集が割り込めた。本関数は FOR UPDATE で行ロックしてから検証→復元を同一 tx で行い、その窓を消す。
--
-- 引数: p_toilet_id, p_edit_id(クライアントが「取消したい」と指定した edit。最新でなければ 409)。
-- 戻り値 jsonb: { "restored": text[], "undo_edit_id": uuid }
-- エラー:
--   'admin_rpc: toilet not found'        → route 404
--   'admin_rpc: no edit to undo'         → route 404(その toilet に edit が無い)
--   'admin_rpc: edit is not latest'      → route 409(p_edit_id が最新 edit でない)
--   'admin_rpc: current value drifted'   → route 409(現在値が当該 edit の after と不一致=後続編集あり)
-- ⚠️ `security definer` + `set search_path = public` の理由は admin_apply_edit と同じ(高権限実行 + search_path
--    注入による権限昇格の封じ)。両方とも外さない。詳細は admin_apply_edit 直上のコメント参照。
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
  v_restore_before jsonb := '{}'::jsonb; -- 取消後に書き戻す値(元 edit の before)
  v_after_snapshot jsonb := '{}'::jsonb; -- 取消の監査 after(=復元後の値)
  v_before_snapshot jsonb := '{}'::jsonb;-- 取消の監査 before(=取消前=元 edit の after)
  v_undo_id uuid;
  -- 復元値(allowlist 列ごとに型付きで取り出す)
  v_name text;
  v_inferred_access text;
  v_has_washlet boolean;
  v_has_diaper_table boolean;
  v_is_universal boolean;
  v_opening_hours text;
begin
  -- ★まず対象トイレを FOR UPDATE でロック。以降の「最新 edit 取得→現在値照合→復元」は全てこの tx 内で
  --   直列化され、検証と適用の間に別 PATCH/undo が割り込めない(旧実装の窓 (C) を消す)。
  select * into v_current from toilets where id = p_toilet_id for update;
  if not found then
    raise exception 'admin_rpc: toilet not found';
  end if;

  -- そのトイレの「最新の admin_edits 行」を 1 件取る。取消行(後述)も admin_edits なので、
  --   最新がすでに取消なら p_edit_id と一致せず 409 になる(= 1 段 undo。連続巻き戻しはしない)。
  -- ⚠️ ロック取得後に読むことが重要: ロック前に読むと、ロック待ちの間に最新 edit が変わりうる。
  --
  -- ★★ order by edit_seq desc(created_at desc では駄目)★★ — Codex 再レビュー R2[high] 対応。
  --   「最新 edit」の判定は単調増加 identity 列 edit_seq(011)でしか厳密化できない。created_at desc にすると:
  --     (1) created_at は default now()。同一トイレへ近接 RPC / 手動挿入で timestamptz が「タイ」になると
  --         Postgres は order by の順序を保証しない(非決定)→ どの行が「最新」か運次第になる。
  --     (2) id は uuid v4 で時系列に単調でない → created_at タイのタイブレークにも使えない。
  --   この 2 点で「古い edit を最新と誤判定」が起き、その edit を before に戻すと後続編集を黙って巻き戻す
  --   (= 「最新のみ取消」の不変条件が破れるデータ破壊)。edit_seq は挿入順に厳密単調・タイ無しなので
  --   max(edit_seq) が常に一意の「最新」になる。
  --   ⚠️ 後任 AI へ: ここを created_at desc に戻さないこと。順序の唯一の真実は edit_seq。
  --      admin_apply_edit が INSERT 時に採番した edit_seq とも整合する(同じ identity 列)。
  select * into v_latest
  from admin_edits
  where toilet_id = p_toilet_id
  order by edit_seq desc
  limit 1;
  if not found then
    raise exception 'admin_rpc: no edit to undo';
  end if;

  -- 不変条件①: クライアントが指定した edit が「最新」であること。最新でなければ取消対象が古い=409。
  --   WHY 409: 後続編集が存在する状態での古い edit の取消は、後続を黙って巻き戻すデータ破壊になる。明示拒否。
  if v_latest.id <> p_edit_id then
    raise exception 'admin_rpc: edit is not latest';
  end if;

  v_changed := array(select jsonb_array_elements_text(v_latest.changed_fields));

  -- 不変条件②: 現在値(allowlist 列)が当該 edit の after と「変化列すべてで一致」すること。
  --   一致しなければ、最新 edit 以降に同じ列を触る別経路の変更があった=409(drift)。
  --   ⚠️ ①と②の両方が成り立って初めて「安全に before へ戻せる」。どちらかを外すと後続編集巻き戻しが再発する。
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
    -- allowlist 外の列名が changed_fields に紛れていても、ここで一切処理しない(無視=安全側)。
  end loop;

  -- ここに到達 = ①最新かつ②現在値が after と一致。安全に before へ復元できる。
  -- 復元値(元 edit の before)を型付きで取り出す。
  v_name := nullif_jsonb_text(v_latest.before, 'name');
  v_inferred_access := v_latest.before->>'inferred_access';
  v_has_washlet := jsonb_to_bool(v_latest.before, 'has_washlet');
  v_has_diaper_table := jsonb_to_bool(v_latest.before, 'has_diaper_table');
  v_is_universal := jsonb_to_bool(v_latest.before, 'is_universal');
  v_opening_hours := nullif_jsonb_text(v_latest.before, 'opening_hours');

  -- 変化列のみ before に戻す(before に存在するキーだけ)。
  update toilets set
    name             = case when v_latest.before ? 'name'             then v_name                          else name end,
    inferred_access  = case when v_latest.before ? 'inferred_access'  then v_inferred_access::access_level else inferred_access end,
    has_washlet      = case when v_latest.before ? 'has_washlet'      then v_has_washlet                   else has_washlet end,
    has_diaper_table = case when v_latest.before ? 'has_diaper_table' then v_has_diaper_table              else has_diaper_table end,
    is_universal     = case when v_latest.before ? 'is_universal'     then v_is_universal                  else is_universal end,
    opening_hours    = case when v_latest.before ? 'opening_hours'    then v_opening_hours                 else opening_hours end
  where id = p_toilet_id;

  -- 取消の監査(append-only)。before=取消前(=元 edit の after)、after=復元後(=元 edit の before)。
  -- これも同一トランザクションで INSERT。失敗すれば復元 UPDATE ごとロールバック(監査なし取消を不可能化)。
  v_before_snapshot := v_latest.after;  -- 取消前の値 = 元 edit の after
  v_after_snapshot := v_latest.before;  -- 取消後の値 = 元 edit の before
  insert into admin_edits (toilet_id, editor, changed_fields, before, after, source_review_id)
  values (p_toilet_id, 'admin', v_latest.changed_fields, v_before_snapshot, v_after_snapshot, null)
  returning id into v_undo_id;

  return jsonb_build_object('restored', to_jsonb(v_changed), 'undo_edit_id', v_undo_id);
end;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (3) 小さな jsonb ヘルパ(undo の型付き比較・復元用)
-- ───────────────────────────────────────────────────────────────────
-- jsonb の boolean フィールドを SQL boolean(または null)に変換する。
--   キーが無い / jsonb null は SQL null を返す(= boolean 列の「不明」と一致)。
create or replace function jsonb_to_bool(p_obj jsonb, p_key text)
returns boolean
language sql
immutable
as $$
  select case
    when p_obj ? p_key and jsonb_typeof(p_obj->p_key) = 'boolean' then (p_obj->>p_key)::boolean
    else null
  end;
$$;

-- jsonb の text フィールドを取り出す。キーが無い / jsonb null は SQL null。
--   (->> は jsonb null を SQL null にするが、キー欠落時も null になり区別不要なのでそのまま使う)
create or replace function nullif_jsonb_text(p_obj jsonb, p_key text)
returns text
language sql
immutable
as $$
  select p_obj->>p_key;
$$;

-- ───────────────────────────────────────────────────────────────────
-- (4) GRANT(service_role 限定 — submit_toilet と同じ多層防御)
-- ───────────────────────────────────────────────────────────────────
-- ⚠️ PostgreSQL は新規 function の EXECUTE を既定で PUBLIC に付与する。GRANT だけでは
--    anon/authenticated も呼べてしまい(Supabase は anon key で RPC 直叩き可)、admin 認証/CSRF を
--    迂回して任意の toilets を編集・取消できる。まず PUBLIC/anon/authenticated から剥がしてから
--    service_role のみに付与する(008 の submit_toilet と同じパターン)。
-- これらの RPC は admin API ルート(secret key = service_role)からのみ呼ばれる。
revoke execute on function admin_apply_edit(uuid, text, jsonb) from public;
revoke execute on function admin_apply_edit(uuid, text, jsonb) from anon, authenticated;
grant execute on function admin_apply_edit(uuid, text, jsonb) to service_role;

revoke execute on function admin_undo_edit(uuid, uuid) from public;
revoke execute on function admin_undo_edit(uuid, uuid) from anon, authenticated;
grant execute on function admin_undo_edit(uuid, uuid) to service_role;

-- ヘルパも anon に開けない(admin RPC の内部実装でのみ使う)。
revoke execute on function jsonb_to_bool(jsonb, text) from public;
revoke execute on function jsonb_to_bool(jsonb, text) from anon, authenticated;
grant execute on function jsonb_to_bool(jsonb, text) to service_role;

revoke execute on function nullif_jsonb_text(jsonb, text) from public;
revoke execute on function nullif_jsonb_text(jsonb, text) from anon, authenticated;
grant execute on function nullif_jsonb_text(jsonb, text) to service_role;

-- ───────────────────────────────────────────────────────────────────
-- 最小権限: service_role から toilets の DELETE を revoke(Codex R3 合意)
-- ───────────────────────────────────────────────────────────────────
-- 001:119 は service_role に toilets の insert/update/delete をまとめて付与しているが、
-- DELETE はどの正当経路も使っていない(seed=upsert で insert/update のみ、admin 編集/取消=UPDATE のみ、
-- not_a_toilet 自己修正=件数で非表示にするだけで行は消さない)。
-- 不要な DELETE を残すと、service key を持つ将来コードや事故で toilet 行を監査外で消せてしまう。
-- INSERT/UPDATE は seed upsert に必須なので残し、DELETE だけ剥がす(非破壊=シードは壊れない)。
-- REVOKE は冪等(存在しない権限の revoke は no-op)なので再適用しても安全。
-- ⚠️ 後で toilet 削除フローが必要になったら、監査付きの admin 専用 RPC を足してそこに集約すること。
--    ここで service_role に DELETE を戻さない(戻すと監査外削除経路が復活する)。
revoke delete on toilets from service_role;
