# TM-FEEDBACK / PROOF — evidence

日付: 2026-08-15

## 実装

- `vendor/feedback-{core,web}` from feedback-platform `@ a9b92f07901d34e2d454b14cc97e7475d23f7458`
- `/contact` にアプリ内フォーム（kind + message、メールなし、Form フォールバック）
- ヘッダ Ko-fi → `ko_fi_click` source=header
- `NEXT_PUBLIC_FEEDBACK_TARGET=prod` は Production のみ（Preview は未設定 → `feedback_dev`）

## 静的検証

- `pnpm test` — 243 passed（含む `src/lib/feedback/client.test.ts`）
- `pnpm run lint` — vendor 内 unused eslint-disable 警告 1（エラー 0）
- `pnpm run build` — 成功（vendor `scripts/` は tree から除外）

## Smoke（ac-fb-1a）

- ローカル `submitFeedback` → `feedback_dev/69650dba-861c-4d1a-a3a9-e4ab0be29b38`
- `product=toilet-map`, `screen=contact`, `wantsReply=false`, `status=new`

## 残（人間ゲート）

1. **Push / Merge GO** → PR 作成・マージ
2. **本番デプロイ GO** → `AI_PUSH_APPROVED=1 vercel --prod`（main 自動デプロイ OFF）
3. 本番 `/contact` から 1 送信 → `feedback` コレクション確認（ac-fb-1b）
4. （任意）GSC: `https://toilet-map-six.vercel.app/` 所有権・sitemap

## GSC メモ（任意）

- 公開 URL: `https://toilet-map-six.vercel.app/`
- sitemap: `/sitemap/0.xml`（robots.txt 参照）
- URL 変更後の再登録が TOOLING 上の残件

## Analytics

- コード上 `ko_fi_click` は header/toilet/about/area で発火
- ダッシュボード有効化の有無はデプロイ後に `get_web_analytics` で確認
