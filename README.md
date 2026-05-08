# 🚽 ピットイン (toilet-map)

近くの公衆トイレを **ピン色(青/黄/赤)** と **星 1-5 の清潔度** で 3 タップ以内に探せる Web アプリ。

- 親ハブ: [🔵 Vercelプロジェクト管理 (Notion)](https://www.notion.so/35a1ef8488d581daba0ef47ff15003c2)
- 詳細仕様: Notion 子ページ「🚽 ピットイン (toilet-map)」

## 技術スタック

| | |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) + TypeScript |
| Style | Tailwind CSS 4 |
| Map | Leaflet + react-leaflet + OpenStreetMap タイル |
| DB | Supabase (PostgreSQL + PostGIS) |
| Auth | Phase 1 では未実装(IP rate limit のみ) |
| PWA | manifest.json (Phase 1)、サービスワーカーは Phase 2 |
| 計測 | Vercel Analytics + Speed Insights |
| Deploy | Vercel |

---

## 3 分セットアップ

### 1) Supabase プロジェクトを作成

1. <https://supabase.com> で無料プロジェクト作成(Region は `Northeast Asia (Tokyo)` 推奨)
2. **Settings → API** から 3 つのキーをコピー:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **Publishable key** (`sb_publishable_...`、旧 anon key、ブラウザ公開可)
   - **Secret key** (`sb_secret_...`、旧 service_role、秘匿)

### 2) DB スキーマを流す

Supabase ダッシュボード **SQL Editor** で `supabase/migrations/001_init.sql` を貼り付けて Run。
PostGIS 拡張・`access_level` enum・`toilets` / `reviews` テーブル・RPC・RLS が一括で作られる。

### 3) 環境変数

```bash
cp .env.local.example .env.local
# エディタで開いて 3 つのキーをペースト
```

### 4) シード(福岡市の OSM データを投入)

```bash
npm run seed
# 出力例:
# ▶ 福岡市: bbox=33.52,130.3,33.72,130.5
#   Overpass からトイレデータ取得中…
#   ✓ 312 件取得
#   Supabase に upsert 中…
#   ✓ 312 件を upsert しました
```

公開後はエリアを順次拡張:

```bash
npm run seed -- --regions fukuoka-pref,tokyo-23
npm run seed -- --region osaka
npm run seed -- --list   # 利用可能なリージョン一覧
```

### 5) 開発サーバー起動

```bash
npm run dev
# → http://localhost:3000
```

位置情報を許可するとマップが現在地中心になる。許可しない場合は博多駅(福岡市シード対象)中心。

---

## ビルド & デプロイ

```bash
npm run build  # 型・リント・最適化
```

Vercel デプロイ:

1. GitHub リポジトリにプッシュ(`git init` 済み、初期コミットあり)
2. <https://vercel.com/new> でインポート
3. **Environment Variables** に `.env.local` の 3 つを設定
4. デプロイ — `npm run build` がそのまま走る

---

## ディレクトリ構成

```
src/
  app/
    layout.tsx           # メタ・PWA・Analytics
    page.tsx             # マップ画面
    privacy/, terms/, contact/
    api/toilets/route.ts # GET: bbox 内のトイレ
    api/reviews/route.ts # POST: 投稿(IP rate limit)
  components/
    Map/                 # ToiletMap, PinSheet, LocateControl, CompassBadge, pinIcon
    ReviewForm.tsx
  lib/
    supabase/{client,server}.ts
    geo.ts               # haversine, bearing
    osm.ts               # Overpass API
    rateLimit.ts         # in-memory 1h/1IP/1trash
    regions.ts           # シード用 bbox プリセット
  store/mapStore.ts      # zustand
  types/toilet.ts
scripts/seed-osm.ts
supabase/migrations/001_init.sql
```

---

## サポート

- バグ・要望: [tosagiken.info@gmail.com](mailto:tosagiken.info@gmail.com)
- データソース: © OpenStreetMap contributors (ODbL)

---

## Phase ロードマップ

- **Phase 1 (MVP, 現在)**: マップ・OSM ピン・認証なし投稿・IP rate limit・PWA・福岡市シード
- **Phase 2**: Supabase Auth・AdSense・貢献者ポイント・ランドマーク重ね表示・スパム AI フィルター
- **Phase 3**: 多言語 (EN/KR/ZH)・Stripe 応援・Flutter 移植検討
