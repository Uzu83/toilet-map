# 🚽 Loo map (toilet-map)

近くの公衆トイレを **ピン色(青/黄/赤)** と **星 1-5 の清潔度** で 3 タップ以内に探せる Web アプリ。
表示名 **Loo map**(2026-05-09 商標調査により旧名「ピットイン」から改名)、リポ名は機能直結の `toilet-map` を維持。

- 本番: https://toilet-map-six.vercel.app/
- 親ハブ: [🔵 Vercelプロジェクト管理 (Notion)](https://www.notion.so/35a1ef8488d581daba0ef47ff15003c2)
- 商標調査ログ: [⚖️ 商標調査ログ](https://www.notion.so/35b1ef8488d58132b7baed8b6830a823)

## 技術スタック

| | |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) + TypeScript |
| Style | Tailwind CSS 4 |
| Map | Leaflet + react-leaflet + OpenStreetMap タイル + leaflet.markercluster |
| Search | Nominatim (OSM 無料 geocoder) |
| DB | Supabase (PostgreSQL + PostGIS) |
| Auth | Phase 1 では未実装(IP rate limit のみ) |
| PWA | manifest.json + ホーム追加プロンプト(SW は Phase 2) |
| 計測 | Vercel Analytics + Speed Insights |
| Deploy | Vercel(GitHub 連携 CD) |

---

## 3 分セットアップ

### 1) Supabase プロジェクトを作成

1. <https://supabase.com> で無料プロジェクト作成(Region は `Northeast Asia (Tokyo)` 推奨)
2. **Settings → API** から 3 つのキーをコピー:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **Publishable key** (`sb_publishable_...`、旧 anon key、ブラウザ公開可)
   - **Secret key** (`sb_secret_...`、旧 service_role、秘匿)

### 2) DB スキーマを流す

Supabase ダッシュボード **SQL Editor** で以下を順に貼り付けて Run:
1. `supabase/migrations/001_init.sql` — PostGIS / enum / テーブル / RPC / RLS / GRANT
2. `supabase/migrations/002_inferred_access.sql` — 推定アクセス + 営業時間カラム
3. `supabase/migrations/003_not_a_toilet_reports.sql` — 「ない」報告 + 5件以上で非表示
4. `supabase/migrations/004_toilet_by_id.sql` — 単一トイレ取得 RPC(deep link 用)
5. `supabase/migrations/005_seo_rpcs.sql` — プログラマティック SEO 用 RPC(id ページャ / 件数 / area)
6. `supabase/migrations/006_seo_rpcs_fast.sql` — SEO RPC 高速化(toilet_stats join 除去 + created_at index)
7. `supabase/migrations/007_seo_indexable.sql` — sitemap の indexable 部分集合 RPC(Issue #1。**deploy 前に apply 必須**)

すべて IF NOT EXISTS / CREATE OR REPLACE で冪等。

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

推定青ピン(駅・モール・公民館・図書館・観光案内所)を追加:

```bash
npm run seed -- --inferred              # 福岡市の推定青ピン追加
npm run seed -- --regions fukuoka-pref,tokyo-23 --inferred
npm run seed -- --region osaka --inferred
npm run seed -- --inferred-only         # amenity=toilets はスキップ、推定のみ
npm run seed -- --list                  # 市区プリセット + 都道府県コード一覧
```

### 全国一括投入(Phase 0 方針: 1万箇所超でリリース)

都道府県境界(ISO 3166-2:JP)で取得:

```bash
npm run seed -- --prefecture JP-13              # 東京都だけ
npm run seed -- --all-japan                     # 47都道府県を順次(amenity=toilets)
npm run seed -- --all-japan --inferred          # 全国 + 推定青ピンも(数十分かかる)
```

`--all-japan` は Overpass のレート制限に配慮して各県の間に 3 秒待機、失敗した県はスキップして続行する。`osm_id` で冪等なので途中で止めても再実行で続きから埋まる。

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

## SEO: indexable ゲートと ISR 予算 (Issue #1)

個別トイレページ(`/toilet/[id]`)は thin-content とクローラ負荷を避けるため、**品質シグナルを満たすものだけ** indexable + sitemap 掲載にしている(canonical predicate):

```
INDEXABLE(t) := not_a_toilet_count < 5
             AND ( review_count > 0 OR ( source='osm' AND 名前あり ) )
```

- TS 側 `src/lib/toiletSeo.ts` の `isToiletIndexable` と SQL 側 `007_seo_indexable.sql` の RPC が**同一述語**(真理値表一致、`src/lib/toiletSeo.test.ts` で固定)。
- **ISR Writes 予算(Vercel Hobby 200K/月)**: 2026-06-14 prod 実測で indexable = **1,434 件**。月間 ISR Writes(toilet) ≈ N × 4 locale × max(D,1) = **5,736(D=1) 〜 22,944(D=4)** で予算内(toilet 枠 120K に対しても余裕)。
- **sitemap チャンク**: `chunk_count = 1 + ceil(N / 11,000) = 2`(チャンク0=静的+area / チャンク1=トイレ)。閾値 **11,000** の根拠 = Google 上限 50,000 URL ÷ 4 locale = 12,500 に余裕を見た値。
- `generateSitemaps` はビルド時にチャンク数確定。**大規模シード後はチャンク数再計算のため再デプロイが必要**。007 は **deploy 前に手動 apply**(未適用だと RPC 未定義 → 0 fallback → sitemap 1 チャンク固定の退行、自動回復しない)。

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

- バグ・要望: アプリ内の `/contact`(Google フィードバックフォーム)から
- 運営: TosaGiken（東佐技研）
- データソース: © OpenStreetMap contributors (ODbL)

---

## Phase ロードマップ

### ✅ Phase 1 完了済み(2026-05-08)
- マップ・OSM ピン・bbox debounce・ピンクラスタリング
- 認証なし投稿・IP rate limit・「ない」報告で 5 件以上自動非表示
- 推定青ピン(駅・モール・公民館・図書館・観光案内所)+ 視覚区別
- フィルタ・距離順リスト・お気に入り・Web Share・Nominatim 検索
- オンボーディング・免責・PWA インストールプロンプト・ダークモード・スケルトン
- Per-toilet URL deep linking(?id=<uuid>)
- /sitemap.xml・/robots.txt・JSON-LD・OG 動的画像・Vercel Analytics

### Phase 2(次)
- Supabase Auth(Email / Google)
- AdSense 層1 バナー + 層2 インタースティシャル
- 貢献者ポイント・ランク制度・スパム AI フィルター
- 「トイレを追加」UI・営業時間自動判定・サービスワーカーオフライン

### Phase 3
- 多言語 (EN/KR/ZH)・Stripe 応援・Flutter ネイティブ移植検討
