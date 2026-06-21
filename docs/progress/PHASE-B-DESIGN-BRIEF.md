# Phase B 設計ブリーフ(Codex 異モデルレビュー用 / 設計記録)

> 2026-06-21。`/phase-b-ai-design` Dynamic Workflow(9 エージェント・3 フェーズ・742k tok)の統合結果 +
> オーナー決定を反映。**実装前**。Codex 異モデルレビューのハンドオフ資料を兼ねる。
> 親進捗: `docs/progress/PROGRESS-admin-ai.md`(Phase B = 69-87 行)。

## 確定したオーナー決定(2026-06-21)
1. **自動反映範囲 = bool 3 列のみ**(`has_washlet` / `has_diaper_table` / `is_universal`)。
   `access_level` / `opening_hours` / `not_a_toilet` は confidence 不問で**承認キュー固定**。
2. **自動反映閾値 = env `AI_AUTO_APPLY_THRESHOLD`=0.85**(server-only、`NEXT_PUBLIC` 禁止、再デプロイなしで調整可)。
3. **LLM = Google Gemini(無料枠)**。当初の Anthropic Claude から変更。理由 = 無料。
4. **次ゲート = Codex 異モデルレビュー**(設計合意。承認でなく合意がゴール)。

## LLM スタック変更(Claude → Gemini)
- 当初プラン(Claude Haiku + `@anthropic-ai/sdk`)から **Gemini 無料枠**へ。
- 採用案: **Vercel AI SDK(`ai`)+ `@ai-sdk/google`**。**AI SDK v6 で `generateObject` は deprecated** →
  `generateText({ model: google("gemini-2.5-flash"), output: Output.object({ schema: zod }) })` を使い `result.output` を読む
  (Context7 `/websites/ai-sdk_dev` で確認、2026-06-21)。Google structured output は `z.union` 非対応(OpenAPI 3.0 制約)なので
  **`value` は `z.string()` で受けサーバ側で field 別に型強制**(union 回避)。`@ai-sdk/google` は `GOOGLE_GENERATIVE_AI_API_KEY` を既定参照。
  - 理由: ①無料(Google AI Studio キー = `GOOGLE_GENERATIVE_AI_API_KEY`)②structured output を zod で強制
    ③将来プロバイダ文字列差し替えで Claude 等へ戻せる ④Vercel 公式パターン。
  - 代替: Vercel AI Gateway 経由 `"google/gemini-2.5-flash"` 文字列(差し替え容易だが無料枠充足は要確認)。
    無料優先のため**実装時に「直接 @ai-sdk/google + AI Studio 無料キー」を既定**とし、gateway は後日検討。
- env: `ANTHROPIC_API_KEY` → **`GOOGLE_GENERATIVE_AI_API_KEY`**(server-only / `NEXT_PUBLIC` 禁止)。
- model ID / 無料枠クォータ(RPM・RPD)/ structured output 仕様は **実装前に Context7・Google 公式で要確認**
  (執筆時点 `gemini-2.5-flash` / `gemini-2.0-flash` が無料枠対象。Gemini に effort 概念は無いので Claude の effort 検証は不要)。
- **設計堅牢性は不変**: 当初から「LLM 出力は信頼しない。サーバ側 enum/allowlist(`validateEdit` 共有)+ DB allowlist
  (`013:130-200`)が最終防壁」。Gemini の structured output も「型は強制できても**値の正しさは保証しない**」ため
  サーバ/DB 検証は同一・必須のまま。**プロバイダ変更は LLM 呼び出しの葉だけ**で、DB/キュー/RPC/セキュリティ多層/
  API guard/段階は provider-agnostic で不変。
- **無料枠の留意(執筆時点・公式要確認)**: Google 無料枠は送信内容を製品改善に利用しうる(有料枠は不利用)。
  本件で送るのは**既に公開済みのレビュー本文のみ**(`ip_hash` 等 PII は送らない)ので露出リスクは低と判断。
  ゼロデータ保持が要るなら有料枠 / Vertex AI へ。

## 核設計(4 レンズ合意・敵対検証済み・provider 非依存)
1. **自動反映は bool 3 列限定**(`value=boolean`・null 不可・`confidence>=閾値`)。`access_level`(改善も悪化も)/
   `opening_hours` / `not_a_toilet` は承認キュー固定。根拠 = `effectiveAccess` は `dominant_access`(レビュー集計)優先で
   `inferred_access` 自動反映の便益が小(`src/types/toilet.ts:62-66`)、誤反映の利用者影響大、OSM 形式生成が不確実。
2. **014 migration**: `ai_suggestions` キュー新設 + `admin_apply_edit` を `CREATE OR REPLACE` して
   `p_source_review_id uuid default null` 追加(`013:228-230` の null ハードコード解消、デフォルト引数で既存 PATCH
   `route.ts:126-130` 非破壊)+ アトミック `ai_apply_suggestion` RPC。
3. **`ai_suggestions` は可変 status**(`008 toilet_submissions` 流の `status text CHECK`)。011 の append-only trigger は
   流用しない(status 遷移するため)。**不変監査は既存 `admin_edits` に一本化**。
4. **二重反映防止 = 部分 UNIQUE INDEX `(toilet_id, field) WHERE status='pending'`** + `ON CONFLICT DO NOTHING`
   (`008:46-52` パターン)。元案 `UNIQUE(review_id, field)` は別レビュー由来の同一 toilet×field 二重反映を防げず却下。
5. **提案 status 更新 + 反映を単一 plpgsql RPC `ai_apply_suggestion` に閉じる**(`FOR UPDATE` 行ロック + pending 検証 +
   `admin_apply_edit(editor='ai')` 反映 + `status=auto_applied` + `applied_edit_seq` 記録を同一 tx)。012 が潰した
   TOCTOU/部分適用の再導入を防ぐ。`security definer` + `set search_path=public` + `#variable_conflict use_column` +
   `array_append`(012/013 の全不変条件踏襲)。
6. **プロンプトインジェクション = 「従わせない」でなく「従っても無害」**: structured output(型強制)+ `<untrusted_comment>`
   フェンス + 脱出文字列 strip + **1 コメント=1 リクエスト**(cross-comment 汚染排除)+ サーバ側 `validateEdit` 共有 +
   DB allowlist の多層。LLM 出力を直接 SQL/RPC に流さない。
7. **API guard 再利用**: `POST /api/admin/analyze` は既存 PATCH guard(`getAdminSession`→401 / `isSameOrigin`→403 /
   入力検証、`route.ts:66-86`)を必須再利用。`isSameOrigin` は Origin/Referer 必須 deny(`adminAuth.ts:252-267`)のため
   batch/cron では通らない=**ブラウザ起点オンデマンドのみ**。反映は同一サーバ内 `supabase.rpc`(service_role)で
   HTTP を再帰させない(CSRF 面を増やさない)。

## 014 migration(規約: 008/011/012/013 踏襲)
- `ai_suggestions`: `id uuid PK` / `seq bigint generated always as identity`(最新判定の単調列、`created_at` は表示専用) /
  `toilet_id uuid not null` / `review_id uuid`(nullable・FK 無し) / `field text CHECK(in EDITABLE_FIELDS)` /
  `value jsonb`(field 型混在のため、`admin_apply_edit` の `p_patch` と対称) / `confidence real CHECK(>=0 and <=1)` /
  `evidence text` / `status text not null default 'pending' CHECK(in pending/approved/rejected/auto_applied)` /
  `applied_edit_seq bigint nullable` / `reviewed_by/review_note/rejected_reason text` / `created_at timestamptz default now()`.
- 部分 `UNIQUE INDEX (toilet_id, field) WHERE status='pending'`.
- `enable row level security`(ポリシー無し=全拒否)。テーブル grant = service_role に `select,insert,update` のみ
  (`delete` 不付与=最小権限)。全 RPC は `REVOKE EXECUTE FROM public,anon,authenticated` → `GRANT service_role`。
- **デプロイ順序**: `014 適用 → live smoke → コードデプロイ`(main 自動 OFF)。
- 併せて **CLAUDE.md の migration 一覧/ファイル数を実態に同期**(現状「現在 12 ファイル」はドリフト、実 13→14)。

## 段階リリース
- **B1**: スキーマ + 分析 API + 承認キュー(**手動 approve/reject のみ・自動反映なし**)。AI は全件 pending に積むだけ
  → 人が全ループ内で AI 抽出品質を観察(誤反映ゼロ)。
- **B2**: 高信頼自動反映(**bool 3 列限定**・`confidence>=AI_AUTO_APPLY_THRESHOLD`)を有効化。`ai_apply_suggestion(auto)`。
  access/opening_hours/not_a_toilet は閾値不問で pending 固定を DB 層でも二重ガード。
- **B3**: UI 仕上げ + ログ衛生(Gemini/AI SDK エラーの redact + Sentry beforeSend scrub)+ 分析回数/トークン上限。

## Codex への論点(openQuestionsForCodex — 設計の穴/分岐、合意したい)
1. **二重反映キー**: 部分 `UNIQUE(toilet_id, field) WHERE status='pending'` で確定してよいか。
   `UNIQUE(review_id, field)`(元案)では別レビュー由来の同一 toilet×field 二重反映を防げない(敵対検証済)。
   両方張る要件(1 レビューが複数 field 提案 / 複数レビューが同一トイレ)はあるか。
2. **RPC 共通化**: `ai_apply_suggestion` が `admin_apply_edit` を内部呼びする際、`SELECT INTO` で呼ぶか共通ロジック切り出すか。
   重複させると 013 の `array_append` 修正のような変更が 2 箇所に必要になる保守リスク。
3. **NULL→permission**: `inferred_access` 未設定(NULL)行から `permission` への初回設定を「悪化方向」として DB 層で拒否するか
   「新規設定」として許すか。enum 順序 `open<ask<permission` に NULL 起点が無い。
4. **evidence 照合**: 「evidence はコメント部分文字列であること」をどこまで厳格に検証するか。LLM が要約/翻訳した evidence は
   原文非一致で弾かれ、誤反映追跡性とのトレードオフ。
5. **LLM/DB tx 境界**: LLM 呼び出し(アプリ層・非トランザクション)と DB 反映(tx)の境界。LLM 失敗時に提案 INSERT も
   巻き戻すか部分記録するか。
6. **no-op 記録**: 「分析したが現在値と同値提案(no-op)」を `ai_suggestions` に記録するか。`admin_apply_edit` は no-op で
   `applied=false`(`013:207-209`)=`admin_edits` に履歴が残らず「AI が見たが変更不要」が消える。

## Codex へのお願い
対等な別視点として**敵対的に**この設計をレビューしてほしい。各論点 1-6 に賛否を**根拠付き**で。ゴールは承認でなく**合意**。
盲目追従不要・過剰指摘不要。1 サイクル①②③、最大 3 サイクル、未収束は人間へ。

---

## Codex 合意・設計修正(2026-06-21)

`codex:rescue` 異モデルレビュー(task `task-mqn3g8gd-sv3u45`、2m5s、判定=**条件付き Go**)で **1 サイクルで合意**。
論点 6 件は全て賛成/条件付き賛成。Claude 側も各点を独立検証して採用(盲目追従でなく合意)。以下を確定設計に反映。

### High(必須・3 件)
1. **`admin_apply_edit` の引数追加は migration 罠**: `CREATE OR REPLACE` で 4 引数版(`p_source_review_id uuid default null`)を
   作っても、既存 3 引数関数は**別シグネチャとして残り**、`route.ts:126-130` の 3 引数呼び出しは旧関数に解決されて
   source_review_id が入らない。→ 014 で**旧 3 引数関数を明示 DROP** してから 4 引数版を作る(route の 3 named-arg 呼び出しは
   default で 4 引数版にバインドされ route 変更不要)。**live smoke で手動 PATCH(editor='admin')非破壊 + AI 経路で
   source_review_id が admin_edits に残ることを確認**。
2. **manual approve も auto apply も単一 RPC/単一 tx**: B1 の手動 approve をアプリ層の「status UPDATE + 別 admin_apply_edit」に
   すると 012 が潰した TOCTOU/部分適用が再発。→ `ai_apply_suggestion(p_suggestion_id, p_actor, p_mode)` を**手動承認と自動反映の
   両方**で使い、`status 更新 + admin_apply_edit + applied_edit_seq 記録` を単一 tx に閉じる。
3. **自動反映 bool 3 列限定を DB 層で強制**: 既存 allowlist(validateEdit/admin_apply_edit)は 6 列許すので「最終防壁」と呼ぶ
   だけでは auto で inferred_access/opening_hours も通る。→ `ai_apply_suggestion` の **`p_mode='auto'` 分岐で
   `field in (has_washlet,has_diaper_table,is_universal)` + `jsonb_typeof(value)='boolean'` + `confidence>=p_threshold` を DB で検証**
   (`p_threshold` はアプリの env `AI_AUTO_APPLY_THRESHOLD` から渡す=tunable は app、構造ガードは DB 固定)。
   **`p_mode='manual'`(人が承認)は標準 6 列 allowlist を許す**(access/opening_hours はこの手動経路でのみ反映=オーナー決定
   「承認キュー固定」と整合)。

### Minor(採用)
- 論点6: no-op(現在値と同値)は admin_edits に残さない(実変更のみ監査)が、`ai_suggestions` に **`status='no_op'` 終端マーカー**を
  持たせ同一コメントの再分析を冪等にスキップ。
- 論点5: **LLM 失敗時は pending 行を作らない**(再試行可能に)。失敗は pending キューに混ぜず別ログ。
- 論点4: **auto 反映の evidence は原文部分文字列必須**(要約/翻訳 evidence は manual キューのみ許容)。追跡性が自動反映の安全性に直結。
  副作用=厳格化で valid 提案が manual に落ちることはあるが安全側(fail-closed)。
- 懸念D: `ai_suggestions` に **`reviewed_at` 追加は採用**。ただし status 遷移のうち**反映(approve/auto)は `ai_apply_suggestion`
  単一 tx 必須**だが、**reject は toilets を変更しないので専用 RPC 不要** — 認証/CSRF guard 付きの `status='rejected'` UPDATE で十分
  (原子性が要るのは toilets+監査を同時に動かす apply 経路のみ。**Claude の独立精査による Codex 懸念 D への部分反論**)。

### Claude の独立追加(Codex 未指摘)
- **`not_a_toilet` は編集可能カラムではない**(allowlist 6 列に無い・reviews 集計シグナル)。AI が検出しても admin_apply_edit では
  反映不能。→ B1/B2 では **admin への情報フラグ表示に留め**、ai_suggestions の適用対象 field には含めない(field CHECK は EDITABLE 6 列のまま)。
- **Gemini 無料枠の RPM 配慮**: 無料枠は RPM が低い(要確認)。B1/B2 は **1 コメント=1 リクエストのオンデマンドのみ**(バッチ分析しない)で
  RPM 内に収める。バッチは将来 backoff 付きで別途。

### Gemini 所見(Codex)= 合意
信頼モデルは設計どおりなら不変(structured output は型のみ強制、サーバ/DB allowlist が最終防壁)。無料枠固有の懸念 3 点(model ID/quota/
structured 仕様は要公式確認 / 送信内容の製品改善利用 / レート制限・品質ばらつき→B1「全件 pending 観察」が妥当)はいずれも認識済み・対策済み。

**合意成立(cycle 1 で収束)**。次ゲート = オーナー承認 → B1 実装。
