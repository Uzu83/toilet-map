# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Subagents

このリポジトリには `.claude/agents/` に 7 つのサブエージェントが定義されている。**自動 orchestration は無い** — ユーザは普通にチャットに投げるだけで、メインセッションがタスクの性質に応じて適切なエージェントに委任する。

| エージェント | 役割 | tools | いつ使う |
|---|---|---|---|
| `coder` | 機能実装・バグ修正・リファクタリング | Read/Write/Edit/Bash/Grep/Glob/Web* | コードを書く作業全般。終了時に必ず `pnpm run lint && pnpm run build` を通す(lint = ESLint、biome/pnpm check は不使用)。コミットはしない |
| `designer` | UI/UX デザイン(視覚・レイアウト・インタラクション・a11y・モバイル UX) | Read/Write/Edit/Bash/Grep/Glob/Web* + Playwright(navigate/resize/snapshot/screenshot/click/hover) | デザイン判断を伴う変更全般。余白/色/状態表現(空・読込・エラー)/コントラスト/タップ領域/モーションの磨き込み。ピン色は型(`ACCESS_LEVELS`)が真実の源で二重管理しない。コピーは seo-writer・機能ロジックは coder に振る。既定 sonnet、大規模リデザインは opus 昇格。コミットはしない |
| `reviewer` | push 前チェック(レビュー専用、コード変更なし) | Read/Bash/Grep/Glob | push 直前。lint/build・公開表記ポリシー違反・i18n 漏れ・セキュリティ・アーキテクチャ規約を監査し指摘リストを返す |
| `seo-writer` | SEO・多言語コピー(ja/en/ko/zh) | Read/Write/Edit/Grep/Glob/Web* | キーワード調査、`messages/*.json` のドラフト、metadata/OGP/JSON-LD 文言、ローカル SEO ランディング文 |
| `planner` | 実装プランニング(コード変更なし) | Read/Grep/Glob/Bash/Web* | 新機能・改修の前のタスク洗い出し・影響範囲調査・段階的プラン作成 |
| `data-osm` | OSM データパイプライン専門 | Read/Write/Edit/Bash/Grep/Glob/Web* | Overpass シード、都市/都道府県カバレッジ拡大、OSM タグパース改善、推定ピン dedup、Phase 2 の AI-RAG エンリッチメント設計。`--all-japan` は勝手に流さない |
| `notion-sync` | 進捗の Notion 反映(コード変更なし) | Read/Bash/Grep/Glob + Notion MCP | 最近のコミットを読んで Loo map Notion ページのステータス・実装サマリ・残タスクを部分更新。事実の追記中心、方針は書き換えない |

共通の遵守事項(全エージェントの定義にも明記):
- **公開表記ポリシー**: サイト UI/OGP/JSON-LD/README/コミットメッセージに本名・事業者メアドを出さない。運営表記は `TosaGiken（東佐技研）`、問い合わせは `src/lib/contact.ts` の Google Form のみ
- **i18n**: 新規 UI 文言は `messages/{ja,en,ko,zh}.json` 4 ファイル全部に追加し `useTranslations()` で参照
- **node は mise 経由**: Bash の先頭に `export PATH="$HOME/.local/share/mise/installs/node/24.14.1/bin:$PATH"`
- コミット・push はメインセッションのみ(サブエージェントはしない)
- Phase 2+ 機能(認証/AdSense/貢献者ポイント/Stripe/トイレ追加 UI)を Phase 1 に混ぜない

## プロジェクト概要

🚽 **Loo map (toilet-map)** — Notion ハブ「🔵 Vercelプロジェクト管理」配下の Phase 1 MVP。
近くの公衆トイレを「許可不要(青) / 一声かけ要(黄) / 許可必要(赤)」のピン色と星 1-5 の清潔度で 3 タップ以内に探せる Web アプリ。Next.js 16 (Turbopack) + Tailwind 4 + Leaflet + Supabase (PostGIS) + PWA。

**表示名 = Loo map(半角スペース付き)**。2026-05-09 J-PlatPat 商標調査により旧名「ピットイン」から改名(出光興産・LIXIL・伊藤忠 CTC・住友三井オートサービス・アールステップが類似区分で登録あり、出願拒絶+警告書リスク高と判定)。リポ名・フォルダ名は機能直結の `toilet-map` 固定 — 表示名のみの変更で済む耐性設計が功を奏した。詳細は Notion 「⚖️ 商標調査ログ」(https://www.notion.so/35b1ef8488d58132b7baed8b6830a823)。

## よく使うコマンド

```bash
npm run dev          # 開発サーバー (http://localhost:3000)
npm run build        # 本番ビルド (型・リント・最適化)
npm run lint         # ESLint (biome ではなく eslint。package.json の "lint" = "next lint")
npm run seed         # 福岡市の OSM トイレデータ投入(.env.local が必要)
npm run seed -- --region tokyo-23        # 市区プリセット
npm run seed -- --regions fukuoka-pref,tokyo-23
npm run seed -- --bbox 33.5,130.3,33.7,130.5
npm run seed -- --inferred               # 駅・モール・公共施設の推定青ピン追加
npm run seed -- --prefecture JP-13       # 都道府県境界で取得 (ISO 3166-2:JP)
npm run seed -- --all-japan              # 47都道府県を順次取得(全国一括、Phase 0 方針)
npm run seed -- --all-japan --inferred   # 全国 + 推定青ピン(数十分)
npm run seed -- --list                   # 市区プリセット + 都道府県コード一覧
```

シード戦略 (Notion「🤖 AI駆動グロース戦略」Phase 0): 全国の `amenity=toilets` を都道府県単位で一括投入し「初期から全国数万箇所表示されるマップ」にしてデータ不足の鶏卵問題を解消する。`--all-japan` は Overpass mirror へのレート制限配慮で各県 3 秒待機・失敗県スキップ・`osm_id` 冪等。`fetchToiletsInPrefecture` / `fetchInferredFacilitiesInPrefecture` は `area["ISO3166-2"="JP-XX"]` で県境界を厳密に取得。

`npm run seed` は `tsx` 経由で `scripts/seed-osm.ts` を実行する。Overpass API (https://overpass-api.de) に叩いて `amenity=toilets` ノードを `toilets` テーブルに `osm_id` で upsert する(冪等)。

## アーキテクチャ要点

- **マップ描画は完全クライアント**: `src/components/Map/ToiletMap.tsx` は `"use client"`、`src/app/page.tsx` から `ClientToiletMap` ラッパー経由で `dynamic(..., { ssr: false })` 読み込み。Leaflet は `window` を触るため SSR 不可。Next 16 は `ssr: false` を Server Component から呼べないので Client ラッパーが必須。
- **bbox フェッチ**: マップ移動時に `BoundsWatcher` が `moveend/zoomend` を購読 → `debounce(500ms)` → `GET /api/toilets?bbox=...` → `toilets_in_bbox` PostGIS RPC。`fetchToilets` は 5xx に対して 1 回リトライ。
- **書き込みは API ルート経由のみ**: RLS で `toilets` / `reviews` の INSERT は publishable key に閉じている。`POST /api/reviews` は secret key で書き込む(`getServerSupabaseSecret()`)。
- **Rate limit**: `src/lib/rateLimit.ts` の in-memory キャッシュで「同 IP × 同トイレ × 1時間 = 1件」。Vercel サーバーレスではインスタンス境界をまたぐと甘くなる。厳格化は Phase 2 で `reviews.ip_hash + created_at` を SQL で見る方式に切替。
- **ピン色 (access_level enum)**: `open=青(声かけ不要) / ask=黄(一声) / permission=赤(許可)`。色定義は `src/types/toilet.ts` の `ACCESS_LEVELS` と `src/app/globals.css` の `--pin-*` で二重管理しない方針 — 型側を真実とする。`effectiveAccess(t)` は dominant → inferred の優先で色決定。
- **推定青ピン (source='inferred')**: 駅・モール・公民館・図書館・観光案内所のみ。コンビニ・ファストフードは customer-only 慣例の例外多発で除外(覇王判断、漏らすUX回避)。視覚区別は `pinIcon.ts` で破線+半透明。レビュー1件でも入れば `source='osm'` 並みの扱いに昇格。
- **「ない」報告 (reviews.not_a_toilet)**: PinSheet の小さなリンクから ReviewForm の report モードへ。集計ビューで `not_a_toilet_count >= 5` のトイレは `toilets_in_bbox` RPC で除外され表示されない(self-correcting)。
- **State 管理**: zustand `mapStore` に `toilets / selectedId / userPos / loading / filters / view / favorites` を集約。`favorites` と `filters` は localStorage 永続。
- **Deep linking**: `?id=<uuid>` で特定ピンに直リンク可。`DeepLinkResolver` が `useMap()` 経由で `flyTo` + `select`、`history.replaceState` で `selectedId` 変化時に URL 同期。
- **シードリージョン**: `src/lib/regions.ts` の `REGIONS` 配列を増やせば、`npm run seed -- --region <key>` で追加投入可能。MVP は `fukuoka-city`、公開後は `fukuoka-pref` + `tokyo-23` → 順次全国に拡張する方針(覇王の指示)。`--inferred` で推定青ピンも追加。`JP_PREFECTURES` には SEO `/area` ページ用の概算 bbox を持たせている(シードの厳密取得には影響しない)。
- **プログラマティック SEO ページ(Phase 1 拡張、`/toilet/[id]` / `/area/[region]` / `/about`)**: いずれも Leaflet を import しない軽量 SSR + ISR(toilet=1h・area=6h・about=静的)。データは `src/lib/toilets.ts`(`getServerSupabasePublishable()` + 005 の RPC、失敗時は null/[]/0 フォールバック)。`/toilet/[id]` は indexable な canonical で、地図側の `?id=<uuid>` deep link は in-map flyTo 用に存続(共有ボタンは `/toilet/[id]` を返す)。`/area/[region]` は `src/lib/areas.ts` の `ALL_AREAS`(市プリセット — `*-pref` キーは jp-NN と重複するので除外 — + 47 都道府県 slug `jp-NN`)、件数 0 のエリアは `robots: noindex`。`sitemap.ts` は `generateSitemaps` で分割(id 0 = 静的 + 全エリア、id 1.. = トイレ個別 ≈ 4 ロケール × 11,000 件/チャンク。チャンク数は `src/lib/sitemapChunks.ts` の `sitemapChunkCount()` で `robots.ts` と共有)— ビルド時に確定するので大規模シード後はチャンク数再計算のため再デプロイが必要。新規ページ文言は `messages/{ja,en,ko,zh}.json` の `toiletPage` / `areaPage` / `about` / `nav.about`。JSON-LD は `src/components/seo/` に `ToiletJsonLd`(Place/PublicToilet + BreadcrumbList)/ `AreaJsonLd`(CollectionPage + BreadcrumbList)/ `FaqJsonLd`(FAQPage)。URL ヘルパは `src/lib/urls.ts`(`absUrl` / `languageAlternates` / `localePrefix` / `inLanguageOf`)。
- **地名の多言語化**: 都道府県(47)+ 市プリセット(`*-pref` 除く)の表示名は `messages/*.json` の `areaNames` 名前空間(キー = slug、例 `jp-40` / `fukuoka-city`)で ja/en/ko/zh を持つ。`src/lib/areas.ts` の `areaLabel(area, t)` に `getTranslations("areaNames")` を渡してロケール別の地名を取得(無ければ `area.label` の日本語にフォールバック)。トイレ名(OSM 由来)は日本語のまま。
- **法務ページの多言語化**: `/privacy` `/terms` `/contact` は `messages/*.json` の `privacy` / `terms` / `contact` 名前空間で 4 言語化済み(以前の「日本語のみ」バナーは廃止、非 ja では `legalNotice.translationNote`「便宜的翻訳。相違があれば日本語版が優先」を表示)。`generateMetadata` で `alternates.canonical` + `languages` も付与。文中のリンクは `t.rich()`(`<link>` / `<osmlink>` プレースホルダ)。

## Supabase 運用

- マイグレーションは `supabase/migrations/00N_*.sql`。Supabase ダッシュボード SQL Editor に貼って実行(または `supabase db push` で CLI)。`IF NOT EXISTS` / `CREATE OR REPLACE` で冪等。
- 現在 17 ファイル: 001(init) / 002(inferred_access + opening_hours) / 003(not_a_toilet) / 004(toilet_by_id RPC) / 005(SEO RPCs: `toilet_ids_page` / `toilet_count` / `toilets_in_region` / `toilets_in_region_count`) / 006(SEO RPC 高速化: `toilets_created_at_idx` 追加 + `toilet_ids_page`/`toilet_count` から重い `toilet_stats` join を除去) / 007(SEO indexable ゲート: `toilet_ids_indexable_page` / `toilet_indexable_count` + named-osm 部分 index) / 008(ユーザー投稿: `toilet_submissions` + `submission_confirmations` ledger + insert-only trigger + `submit_toilet` アトミック RPC + `pending_submissions_in_bbox` + `nearby_toilet`) / 009(`toilets.source` CHECK 制約) / 010(`submit_toilet` の OUT 列名/テーブル列名衝突を `#variable_conflict use_column` で修正 — 本番スモークで POST 500 を検出) / 011(`/admin` 監査ログ: `admin_edits` テーブル + append-only trigger(UPDATE/DELETE 拒否)+ service_role insert/select 限定。手動編集の before/after を記録、取消も追記で表現。`edit_seq bigint generated always as identity` を「最新 edit」判定の唯一の真実とする — `created_at` は default now() でタイ非決定 + uuid v4 非単調なので順序判定に使わない(表示専用)、index は `(toilet_id, edit_seq desc)`) / 012(`/admin` 編集/取消のアトミック RPC: `admin_apply_edit` / `admin_undo_edit`。Codex 異モデルレビューの「編集+監査の非アトミック性(TOCTOU=lost update・監査欠落・非アトミック undo)」を解消。`submit_toilet` パターン踏襲で `SELECT ... FOR UPDATE` 行ロック + 列ホワイトリストを DB 層にも固定 + 変化列のみ UPDATE と admin_edits INSERT を単一トランザクションで実行。`#variable_conflict use_column`。service_role 限定 grant。**live smoke 必須** — 行ロック/列衝突/409 不変条件は vitest モックでは検証不能) / 013(`admin_apply_edit` の本番 500「malformed array literal」修正: `v_changed || 'field'` を `array_append(v_changed, 'field')` に統一。012 を書き換えず CREATE OR REPLACE で supersede。**実値変更の PATCH live smoke 必須**) / 014(AI 提案キュー: `ai_suggestions` テーブル + `ai_apply_suggestion` アトミック RPC + `ai_apply_suggestion` の 4 引数 `admin_apply_edit` 拡張。bool3 列限定・confidence>=閾値・original_review_id 追跡の三重ガード。**live smoke 必須**) / 015(`ai_suggestions` の DELETE/TRUNCATE を service_role から明示 REVOKE。014 の `grant select,insert,update only` では Supabase default-privileges で DELETE が残るため別途 REVOKE が必要) / 016(append-only テーブル(admin_edits/submission_confirmations)と toilets の TRUNCATE を service_role から REVOKE。行 trigger は TRUNCATE を捕捉しないため trigger だけでは不変条件が破られる穴を塞ぐ) / 017(reviews テーブルの anon/authenticated 直 SELECT を閉じて ip_hash PII 露出を修正。app は全て service_role 経由 + toilet_by_id RPC 経由なので非破壊)。**005–017 はデプロイ前に手動適用が必要**(SEO ページ・sitemap・トイレ追加申請・/admin 編集・AI 提案が依存)。**PostgREST(Supabase API)は 1 レスポンス最大 1000 行**なので、`getIndexableToiletIdsPage()` は 1000 行ずつ内部ページングして必要件数を集める(`toilet_ids_indexable_page` RPC に大きい `p_limit` を渡しても 1000 で切れる)。
- **デプロイ順序(008/009/010)**: `008 → 009 → 010 適用` → smoke test(申請 POST が 200/201、`/api/submissions?bbox=` が 200、既存 `/api/toilets` が壊れていない) → **その後コードデプロイ**。順序を誤ると `toilet_submissions`/RPC 不在で `/api/submissions` が 500、最悪 `/api/toilets` まで巻き込んで地図が壊れる。`submit_toilet` は **service_role 限定**(008 で PUBLIC/anon から REVOKE 済 — anon key 直叩き迂回を防止、適用漏れ厳禁)。
- **デプロイ順序(011/012, /admin)**: `011 適用`(`admin_edits` + trigger)→ `012 適用`(`admin_apply_edit` / `admin_undo_edit` + ヘルパ + service_role 限定 grant)→ Vercel に env `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET` 設定(server-only、**NEXT_PUBLIC 禁止**)→ **live smoke**(`/admin/login` でログイン→cookie 発行、`PATCH /api/admin/toilets/[id]` が 200 + `admin_edits` に追記、no-op が 200/changed:[]、`DELETE ...?editId=` の取消が動き「最新でない/現在値 drift」で 409、既存 `/api/toilets` 非破壊)→ **その後コードデプロイ**。011/012 未適用のまま deploy すると `PATCH/DELETE /api/admin/toilets/[id]` が `admin_edits`/RPC 不在で 500。env 未設定だと `/admin` はフェイルクローズで誰もログインできない。`admin_edits` は **append-only trigger** で UPDATE/DELETE 拒否(service_role でも追記専用)。**012 の plpgsql 本体(FOR UPDATE 行ロック・`#variable_conflict use_column`・409 不変条件・監査の同一トランザクション性)は vitest モックでは検証できない** — submit_toilet の列衝突を本番 500 で踏んだ教訓と同じく live smoke が唯一の検証手段。`admin_apply_edit`/`admin_undo_edit` は **service_role 限定**(012 で PUBLIC/anon から REVOKE 済 — anon key 直叩きで admin 認証/CSRF を迂回した編集を防止、適用漏れ厳禁)。**admin による toilets 変更は必ず監査 RPC(`admin_apply_edit`/`admin_undo_edit`)経由**(route で直接 `.update()` しない=監査一貫性、guard コメント済)。`service_role` の `toilets` 広域 UPDATE 権限(001:119)は **revoke しない** — seed-osm の `.upsert(onConflict osm_id)`=INSERT…ON CONFLICT DO UPDATE がこの grant に依存するため(監査必須は admin 編集パスに限定する設計判断、詳細は 012 冒頭)。「undo の最新 edit」は `created_at` でなく単調列 `edit_seq desc` で判定(タイ非決定/uuid 非単調回避)。
- **main は自動デプロイ OFF(`vercel.json` の `git.deploymentEnabled.main=false`)**: migration 依存変更で「コード先行デプロイ → RPC 不在で 500」事故を防ぐため、**本番デプロイは手動**にしている(feature ブランチの preview 自動ビルドは残す)。本番反映の手順 = ①Supabase に新規 migration を手動適用 → ②smoke → ③手動で本番デプロイ(Vercel dashboard の "Deploy"/"Redeploy"、`vercel --prod`、または MCP `deploy_to_vercel`)。**main に push しても自動ではデプロイされない**ことに注意。
- スキーマ変更は **新ファイル** で追加(既存を書き換えない)。
- PostGIS の point 投入は WKT (`SRID=4326;POINT(lng lat)`) で文字列リテラル。
- API キーは新形式(`sb_publishable_*` / `sb_secret_*`)対応済み。env 名は `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`。

## 設計判断ログ (Notion 由来)

- **写真投稿なし**: 通信コスト・モデレーションコスト・UX 低下のため意図的に排除。レビューはテキストのみ。
- **10件未満は「評価不足」表示**: スパム対策と初期空備対策の両立。
- **3タップ以内動線**: 起動 → 位置許可 → マップ → ピンタップ → 詳細。導線を増やすときはこの原則と衝突しないか確認。

## Phase 範囲

- **Phase 1 (MVP, この実装)**: マップ + OSM ピン + bbox フェッチ + 認証なし投稿 + IP rate limit + PWA + プライバシー/規約。
- **Phase 2**: ✅ **ユーザー投稿によるトイレ追加申請フロー(Issue #2, 実装済)** / Supabase Auth (Email/Google)〔未〕 + AdSense 層1+層2〔未〕 + 貢献者ポイント〔未〕 + スパム AI フィルター〔未〕 + ランドマーク重ね表示〔未〕。
- **Phase 3**: 多言語 (EN/KR/ZH, 実装済) + Stripe 応援 + Flutter 移植検討 + ユーザー投稿の Sybil 耐性強化(Auth ベース)。

Phase 2+ の未実装機能を勝手に Phase 1 に混ぜない(スコープ膨張回避)。

## モデレーション運用 (Phase 2 ユーザー投稿)

ユーザーは匿名でトイレ追加を**申請**でき、多層防御 + ハイブリッド承認で公開する。AC3(モデレーション体制)の文書化を兼ねる。

- **多層防御 4 層**: ①IP rate limit(in-memory, 同一 IP×座標バケット, 成功時のみ枠消費) ②同一地点 5 分スロットル(DB側 `submit_toilet`, 地点グローバル=IP に直交) ③distinct-ip confirm ledger(`submission_confirmations` + `UNIQUE(submission_id, ip_hash)` + append-only trigger) ④not_a_toilet 自己修正(`>=5` で非表示、dedup 対象からも除外)。
- **自動承認(ハイブリッド)**: 同一地点(30m, ST_DWithin)への申請が **distinct-ip で confirm_count>=3** に達したら自動で `toilets` へ **insert-only** 昇格(`source='user'`, `inferred_access`=申請 access、status='approved')。閾値未満は pending(薄色ピン)のまま他ユーザーの追認を待つ。
- **手動モデレーション(初期)**: 専用管理画面は未実装。Supabase dashboard から `toilet_submissions` を直接確認し、`status`/`rejected_reason`/`review_note`/`reviewed_by` を手動更新する。本格的な管理 UI は将来タスク。
- **却下/抑止基準**: 既存トイレ(可視, not_a_toilet<5)の 30m 以内 → `dup`(申請を作らず既存へ誘導)。非表示の偽陽性(not_a_toilet>=5)近傍は dup 扱いせず新規 pending として受理(正当な再登録を妨げない)。
- **不変条件(既存 OSM ピン非破壊 = AC4)**: 昇格は **INSERT のみ**(既存 `toilets` 行を UPDATE/DELETE しない)。`toilets.source` は CHECK 制約(`osm`/`user`/`inferred`)で固定。ledger は trigger で追記専用。
- **残存リスク**: 多 IP + 5 分待機による単発偽承認(Sybil)は受容済み(`x-real-ip` 優先で XFF 詐称は緩和)。完全な耐性は Phase 3 の Auth 導入で強化する。
- **SEO**: user 投稿トイレは既存ルール踏襲でレビュー 1 件以上から indexable(007 の `review_count>0` ブランチが source 非依存。未レビュー user は inferred 同様 noindex)。

## 関連 Notion ページ

- 親ハブ: [🔵 Vercelプロジェクト管理](https://www.notion.so/35a1ef8488d581daba0ef47ff15003c2)
- 本アプリ: [🚽 Loo map (toilet-map)](https://www.notion.so/35a1ef8488d581abb452c26dc5fed7f1)
- 詳細仕様(旧ページ、ピットイン名のまま): [🚽 ピットイン -近くのトイレ専用地図アプリ-](https://www.notion.so/35a1ef8488d581afaf3fff53da269f9c)
- 商標調査ログ: [⚖️ 商標調査ログ](https://www.notion.so/35b1ef8488d58132b7baed8b6830a823)
- 共通テンプレ: [⚡ Next.js初期セットアップ](https://www.notion.so/35a1ef8488d5815290bcd07ac5937e4f) / [📊 Vercel Analytics](https://www.notion.so/35a1ef8488d5814ba4fef7372dc88c38) / [🎨 Tailwindデザインルール](https://www.notion.so/35a1ef8488d58116b2befd42347840b3) / [🔍 SEO最適化](https://www.notion.so/35a1ef8488d581e196e2c4db8521d461)
