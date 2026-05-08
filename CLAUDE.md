# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## プロジェクト概要

🚽 **ピットイン (toilet-map)** — Notion ハブ「🔵 Vercelプロジェクト管理」配下の Phase 1 MVP。
近くの公衆トイレを「許可不要(青) / 一声かけ要(黄) / 許可必要(赤)」のピン色と星 1-5 の清潔度で 3 タップ以内に探せる Web アプリ。Next.js 15 (Turbopack) + Tailwind 4 + Leaflet + Supabase (PostGIS) + PWA。

仮称「ピットイン」は **商標調査未完了**(J-PlatPat 9類)。リネーム耐性のためリポ名・フォルダ名は機能直結の `toilet-map` 固定 — 表示名のみ変更可能な設計を維持すること。

## よく使うコマンド

```bash
npm run dev          # 開発サーバー (http://localhost:3000)
npm run build        # 本番ビルド (型・リント・最適化)
npm run lint         # ESLint
npm run seed         # 福岡市の OSM トイレデータ投入(.env.local が必要)
npm run seed -- --region tokyo-23
npm run seed -- --regions fukuoka-pref,tokyo-23
npm run seed -- --bbox 33.5,130.3,33.7,130.5
npm run seed -- --list                   # 利用可能リージョン一覧
```

`npm run seed` は `tsx` 経由で `scripts/seed-osm.ts` を実行する。Overpass API (https://overpass-api.de) に叩いて `amenity=toilets` ノードを `toilets` テーブルに `osm_id` で upsert する(冪等)。

## アーキテクチャ要点

- **マップ描画は完全クライアント**: `src/components/Map/ToiletMap.tsx` は `"use client"`、`src/app/page.tsx` から `dynamic(..., { ssr: false })` で読み込む。Leaflet は `window` を触るため SSR 不可。
- **bbox フェッチ**: マップ移動時に `BoundsWatcher` が `moveend/zoomend` を購読 → `debounce(500ms)` → `GET /api/toilets?bbox=...` → `toilets_in_bbox` PostGIS RPC。
- **書き込みは API ルート経由のみ**: RLS で `toilets` / `reviews` の INSERT は publishable key に閉じている。`POST /api/reviews` は secret key で書き込む(`getServerSupabaseSecret()`)。
- **Rate limit**: `src/lib/rateLimit.ts` の in-memory キャッシュで「同 IP × 同トイレ × 1時間 = 1件」。Vercel サーバーレスではインスタンス境界をまたぐと甘くなる。厳格化は Phase 2 で `reviews.ip_hash + created_at` を SQL で見る方式に切替。
- **ピン色 (access_level enum)**: `open=青(声かけ不要) / ask=黄(一声) / permission=赤(許可)`。色定義は `src/types/toilet.ts` の `ACCESS_LEVELS` と `src/app/globals.css` の `--pin-*` で二重管理しない方針 — 型側を真実とする。
- **シードリージョン**: `src/lib/regions.ts` の `REGIONS` 配列を増やせば、`npm run seed -- --region <key>` で追加投入可能。MVP は `fukuoka-city`、公開後は `fukuoka-pref` + `tokyo-23` → 順次全国に拡張する方針(覇王の指示)。

## Supabase 運用

- マイグレーションは `supabase/migrations/001_init.sql`。Supabase ダッシュボード SQL Editor に貼って実行(または `supabase db push` で CLI)。`IF NOT EXISTS` / `do $$` で冪等。
- スキーマ変更は **新ファイル** `002_*.sql` 等で追加(既存を書き換えない)。
- PostGIS の point 投入は WKT (`SRID=4326;POINT(lng lat)`) で文字列リテラル。

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
- 本アプリ: [🚽 ピットイン (toilet-map)](https://www.notion.so/35a1ef8488d581abb452c26dc5fed7f1)
- 詳細仕様: [🚽 ピットイン -近くのトイレ専用地図アプリ-](https://www.notion.so/35a1ef8488d581afaf3fff53da269f9c)
- 共通テンプレ: [⚡ Next.js初期セットアップ](https://www.notion.so/35a1ef8488d5815290bcd07ac5937e4f) / [📊 Vercel Analytics](https://www.notion.so/35a1ef8488d5814ba4fef7372dc88c38) / [🎨 Tailwindデザインルール](https://www.notion.so/35a1ef8488d58116b2befd42347840b3) / [🔍 SEO最適化](https://www.notion.so/35a1ef8488d581e196e2c4db8521d461)
