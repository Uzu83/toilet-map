# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Subagents

このリポジトリには `.claude/agents/` に 4 つのサブエージェントが定義されている。**自動 orchestration は無い** — ユーザは普通にチャットに投げるだけで、メインセッションがタスクの性質に応じて適切なエージェントに委任する。

| エージェント | 役割 | tools | いつ使う |
|---|---|---|---|
| `coder` | 機能実装・バグ修正・リファクタリング | Read/Write/Edit/Bash/Grep/Glob/Web* | コードを書く作業全般。終了時に必ず `pnpm run lint && pnpm run build` を通す。コミットはしない |
| `reviewer` | push 前チェック(レビュー専用、コード変更なし) | Read/Bash/Grep/Glob | push 直前。lint/build・公開表記ポリシー違反・i18n 漏れ・セキュリティ・アーキテクチャ規約を監査し指摘リストを返す |
| `seo-writer` | SEO・多言語コピー(ja/en/ko/zh) | Read/Write/Edit/Grep/Glob/Web* | キーワード調査、`messages/*.json` のドラフト、metadata/OGP/JSON-LD 文言、ローカル SEO ランディング文 |
| `planner` | 実装プランニング(コード変更なし) | Read/Grep/Glob/Bash/Web* | 新機能・改修の前のタスク洗い出し・影響範囲調査・段階的プラン作成 |

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
npm run lint         # ESLint
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
- **シードリージョン**: `src/lib/regions.ts` の `REGIONS` 配列を増やせば、`npm run seed -- --region <key>` で追加投入可能。MVP は `fukuoka-city`、公開後は `fukuoka-pref` + `tokyo-23` → 順次全国に拡張する方針(覇王の指示)。`--inferred` で推定青ピンも追加。

## Supabase 運用

- マイグレーションは `supabase/migrations/00N_*.sql`。Supabase ダッシュボード SQL Editor に貼って実行(または `supabase db push` で CLI)。`IF NOT EXISTS` / `CREATE OR REPLACE` で冪等。
- 現在 4 ファイル: 001(init) / 002(inferred_access + opening_hours) / 003(not_a_toilet) / 004(toilet_by_id RPC)。
- スキーマ変更は **新ファイル** で追加(既存を書き換えない)。
- PostGIS の point 投入は WKT (`SRID=4326;POINT(lng lat)`) で文字列リテラル。
- API キーは新形式(`sb_publishable_*` / `sb_secret_*`)対応済み。env 名は `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`。

## 設計判断ログ (Notion 由来)

- **写真投稿なし**: 通信コスト・モデレーションコスト・UX 低下のため意図的に排除。レビューはテキストのみ。
- **10件未満は「評価不足」表示**: スパム対策と初期空備対策の両立。
- **3タップ以内動線**: 起動 → 位置許可 → マップ → ピンタップ → 詳細。導線を増やすときはこの原則と衝突しないか確認。

## Phase 範囲

- **Phase 1 (MVP, この実装)**: マップ + OSM ピン + bbox フェッチ + 認証なし投稿 + IP rate limit + PWA + プライバシー/規約。
- **Phase 2**: Supabase Auth (Email/Google) + AdSense 層1+層2 + 貢献者ポイント + スパム AI フィルター + ランドマーク重ね表示。
- **Phase 3**: 多言語 (EN/KR/ZH) + Stripe 応援 + Flutter 移植検討。

Phase 2+ の機能を Phase 1 に混ぜない(スコープ膨張回避)。

## 関連 Notion ページ

- 親ハブ: [🔵 Vercelプロジェクト管理](https://www.notion.so/35a1ef8488d581daba0ef47ff15003c2)
- 本アプリ: [🚽 Loo map (toilet-map)](https://www.notion.so/35a1ef8488d581abb452c26dc5fed7f1)
- 詳細仕様(旧ページ、ピットイン名のまま): [🚽 ピットイン -近くのトイレ専用地図アプリ-](https://www.notion.so/35a1ef8488d581afaf3fff53da269f9c)
- 商標調査ログ: [⚖️ 商標調査ログ](https://www.notion.so/35b1ef8488d58132b7baed8b6830a823)
- 共通テンプレ: [⚡ Next.js初期セットアップ](https://www.notion.so/35a1ef8488d5815290bcd07ac5937e4f) / [📊 Vercel Analytics](https://www.notion.so/35a1ef8488d5814ba4fef7372dc88c38) / [🎨 Tailwindデザインルール](https://www.notion.so/35a1ef8488d58116b2befd42347840b3) / [🔍 SEO最適化](https://www.notion.so/35a1ef8488d581e196e2c4db8521d461)
