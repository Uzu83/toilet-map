-- 013_fix_admin_apply_edit_array_append.sql — admin_apply_edit の本番 500(malformed array literal)を修正
-- 実行: Supabase ダッシュボード > SQL Editor で全文ペースト → Run(または supabase db push)。冪等(CREATE OR REPLACE)。
--
-- ───────────────────────────────────────────────────────────────────
-- 症状(本番 live smoke で発生)
-- ───────────────────────────────────────────────────────────────────
-- PATCH /api/admin/toilets/[id] で「値が実際に変わる」編集を投げると HTTP 500。
-- Supabase postgres ログの実エラー文(そのまま):
--     ERROR: malformed array literal: "inferred_access"
-- ⚠️ no-op smoke(値が変わらない PATCH)では露見しなかった。後述の落ちる行は
--    「実際に値が変わったフィールドで初めて到達する」ため、changed が空のままだと通り抜けてしまう。
--    012 のデプロイ前 smoke が no-op 中心だったので本番の「実編集」で初めて踏んだ。
--
-- ───────────────────────────────────────────────────────────────────
-- 根本原因(plpgsql の text[] || リテラル連結の罠)
-- ───────────────────────────────────────────────────────────────────
-- 012 の admin_apply_edit は、変化した列名を集める配列に対して
--     v_changed text[] := '{}';
--     ...
--     v_changed := v_changed || 'inferred_access';   -- ← これが原因
-- と「型未確定の文字列リテラルを || で連結」していた。
--
-- Postgres の || は文脈で多重定義される演算子で、左辺が text[] の場合
--   - array || element (anyarray || anyelement)  … 末尾に1要素追加
--   - array || array   (anyarray || anyarray)    … 配列同士の結合
-- の両方の候補があり、右辺がベア文字列リテラル('inferred_access' は型未確定 = unknown)だと、
-- Postgres は array || array の方に解決し、右辺リテラルを「text[] の配列リテラル」としてパースしようとする。
-- 'inferred_access' は配列リテラルの形式(中括弧 {...})ではないので
--     malformed array literal: "inferred_access"
-- で落ちる。'name' 等でも同様に落ちうるが、本番では inferred_access を変える編集で最初に踏んだ。
--
-- ───────────────────────────────────────────────────────────────────
-- 修正(array_append に統一)
-- ───────────────────────────────────────────────────────────────────
-- 6箇所すべて
--     v_changed := v_changed || '<field>';
-- を
--     v_changed := array_append(v_changed, '<field>');
-- に置換する。array_append(anyarray, anyelement) は「配列に要素を1個足す」という意味が一意で、
-- 第2引数の型が array に解決される余地が無い(= 型曖昧ゼロ)。
--
-- WHY array_append であって `|| '...'::text` ではないか:
--   `v_changed || 'inferred_access'::text` と右辺を明示キャストしても今は直る(unknown でなく text になり
--   anyarray || anyelement に解決される)。だが将来この `::text` を誰かが「冗長」と判断して落とすと、
--   再び unknown リテラルになり array||array へ解決され、同じ malformed array literal が再発する。
--   array_append は「要素追加」という関数名で意図が自明・キャスト依存が無いので堅牢。よって array_append を採る。
--
-- ⚠️⚠️ 後任 AI への強い警告:
--   plpgsql で text[](や任意の array)変数にベアな文字列リテラルを `||` で足すコードを二度と書かないこと。
--   `arr := arr || 'foo';` は「array || array」に解決されて malformed array literal で落ちる地雷。
--   要素を1つ足したいときは必ず `arr := array_append(arr, 'foo');` を使う。
--   (undo 側 admin_undo_edit は `v_changed := array(select jsonb_array_elements_text(...))` で配列を組むので
--    この罠は無い = Codex 異モデルレビューで確認済み。本ファイルでは触らない。)
--
-- ───────────────────────────────────────────────────────────────────
-- なぜ 012 を書き換えず 013 で CREATE OR REPLACE するのか
-- ───────────────────────────────────────────────────────────────────
-- 012 は本番に手動 apply 済み。適用済みの migration を後から書き換えると「リポジトリの 012」と
-- 「本番に当たった 012」が乖離し、再現性が崩れる(後任が 012 を読んでも本番の実態が分からない)。
-- よって 012 はそのまま残し、本 013 が CREATE OR REPLACE FUNCTION で admin_apply_edit を上書きして
-- 当該 6 行を supersede する。010 が 008 の submit_toilet 列衝突を新ファイルで直したのと同じ流儀。
-- CREATE OR REPLACE なので冪等(再適用しても安全)。
--
-- ───────────────────────────────────────────────────────────────────
-- ⚠️ デプロイ前に「手動 apply + live smoke」が必須(005-012 と同様)
-- ───────────────────────────────────────────────────────────────────
-- 適用順: 013 を apply → live smoke → コードデプロイ。
-- smoke は必ず「値が実際に変わる PATCH」で行う(no-op PATCH では今回のバグは再発せず=検証にならない)。
--   例: 既存トイレに対し inferred_access を別値へ変える PATCH を投げ、200 + admin_edits に追記 + changed に
--       'inferred_access' が載ること、続けて has_washlet/opening_hours など各列の実変更が 200 で通ることを確認。
-- ⚠️ plpgsql 本体ロジック(FOR UPDATE 行ロック・列衝突・409 不変条件・||→array_append)は vitest モックでは
--    検証できない(MEMORY: DB RPC live smoke)。本番/staging の実 DB スモークが唯一の検証手段。

-- ───────────────────────────────────────────────────────────────────
-- admin_apply_edit — allowlist 列だけをアトミックに UPDATE + 監査 INSERT(012 と同一、|| を array_append 化のみ)
-- ───────────────────────────────────────────────────────────────────
-- ※ 引数・戻り値・エラーの意味・security definer/search_path の不変条件は 012 のコメントと同じ。
--   ここでは「012 からの変更点 = v_changed の連結を array_append に置換した 6 箇所だけ」であることを示すため
--   関数本体を忠実にコピーしている(ロジックは一切変えていない)。012 冒頭の詳細 WHY も併せて参照のこと。
--
-- ⚠️ `security definer` + `set search_path = public` は両方とも不変条件(012 踏襲・消さない):
--   - security definer: 監査 RPC だけが toilets を変更できる前提を保つための高権限実行。
--   - set search_path = public: 呼び出し側の search_path 細工によるニセ関数/テーブル注入(権限昇格)封じ。
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
      -- ⚠️ 012 では `v_changed := v_changed || 'name';` だったが malformed array literal で落ちるため
      --    array_append に修正(本ファイル冒頭の WHY 参照)。以下 6 列すべて同じ修正。
      v_changed := array_append(v_changed, 'name');
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
      v_changed := array_append(v_changed, 'inferred_access');
      v_before := v_before || jsonb_build_object('inferred_access', to_jsonb(v_current.inferred_access::text));
      v_after  := v_after  || jsonb_build_object('inferred_access', to_jsonb(v_inferred_access));
    end if;
  end if;

  -- boolean 3 列(true/false/null=不明)。
  if p_patch ? 'has_washlet' then
    v_has_washlet := (p_patch->>'has_washlet')::boolean;  -- jsonb null → SQL null
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

  -- opening_hours(string か null)。
  if p_patch ? 'opening_hours' then
    v_opening_hours := p_patch->>'opening_hours';
    if v_current.opening_hours is distinct from v_opening_hours then
      v_changed := array_append(v_changed, 'opening_hours');
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
-- GRANT(service_role 限定 — 012 と同じ多層防御。CREATE OR REPLACE で関数を作り直したので再掲して自己完結させる)
-- ───────────────────────────────────────────────────────────────────
-- ⚠️ PostgreSQL は新規 function の EXECUTE を既定で PUBLIC に付与する。GRANT だけでは
--    anon/authenticated も呼べてしまい(Supabase は anon key で RPC 直叩き可)、admin 認証/CSRF を
--    迂回して任意の toilets を編集できる。まず PUBLIC/anon/authenticated から剥がしてから service_role のみに付与。
-- ※ CREATE OR REPLACE は既存の権限設定を保持するので 012 適用済みなら実質 no-op だが、
--    「013 単体でも正しい権限になる」自己完結性のため再掲する(冪等)。
revoke execute on function admin_apply_edit(uuid, text, jsonb) from public;
revoke execute on function admin_apply_edit(uuid, text, jsonb) from anon, authenticated;
grant execute on function admin_apply_edit(uuid, text, jsonb) to service_role;
