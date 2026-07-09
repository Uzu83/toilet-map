# Repository Map

<!-- /dev-secure scope:docs が配置。
     二層構造: AUTO マーカー内は scripts/generate-repo-map.mjs が再生成、
     マーカー外は人間と AI が手で育てる。**手書きセクションをマーカー内に
     移動しないこと**（再生成で消える）。 -->

## System overview

<!-- 手書き: このリポジトリの責務・外部システム・主要データフローを 3〜5 行で -->

（TODO: /dev-secure 導入時に記入）

## 自動生成セクション

<!-- repo-map:auto:begin -->
<!-- このブロックは scripts/generate-repo-map.mjs が再生成する。手で編集しない -->

_最終生成: 2026-07-09T14:41:12.414Z / commit: f2d113c_

### トップレベル構成

| Path | Files |
|---|---:|
| `.agents/` | 4 |
| `.claude/` | 11 |
| `.codex/` | 3 |
| `.env.example` | 1 |
| `.github/` | 4 |
| `.gitignore` | 1 |
| `.gitleaks.toml` | 1 |
| `AGENTS.md` | 1 |
| `CLAUDE.md` | 1 |
| `docs/` | 13 |
| `eslint.config.mjs` | 1 |
| `messages/` | 4 |
| `mise.toml` | 1 |
| `next.config.ts` | 1 |
| `package.json` | 1 |
| `pnpm-lock.yaml` | 1 |
| `postcss.config.mjs` | 1 |
| `public/` | 8 |
| `README.md` | 1 |
| `REPO_MAP.md` | 1 |
| `scripts/` | 3 |
| `sentry.edge.config.ts` | 1 |
| `sentry.server.config.ts` | 1 |
| `src/` | 106 |
| `supabase/` | 18 |
| `tsconfig.json` | 1 |
| `vercel.json` | 1 |
| `vitest.config.ts` | 1 |

### ルート（公開表面）

- `src/app/[locale]/about/page.tsx`
- `src/app/[locale]/area/[region]/page.tsx`
- `src/app/[locale]/contact/page.tsx`
- `src/app/[locale]/layout.tsx`
- `src/app/[locale]/page.tsx`
- `src/app/[locale]/privacy/page.tsx`
- `src/app/[locale]/terms/page.tsx`
- `src/app/[locale]/toilet/[id]/page.tsx`
- `src/app/admin/layout.tsx`
- `src/app/admin/login/page.tsx`
- `src/app/admin/page.tsx`
- `src/app/api/admin/analyze/route.ts`
- `src/app/api/admin/login/route.ts`
- `src/app/api/admin/logout/route.ts`
- `src/app/api/admin/reviews/route.ts`
- `src/app/api/admin/suggestions/[id]/route.ts`
- `src/app/api/admin/toilets/[id]/route.ts`
- `src/app/api/reviews/route.ts`
- `src/app/api/submissions/route.ts`
- `src/app/api/toilets/[id]/route.ts`
- `src/app/api/toilets/route.ts`

### コマンド

- `pnpm dev` — `next dev`
- `pnpm build` — `next build`
- `pnpm start` — `next start`
- `pnpm lint` — `eslint`
- `pnpm test` — `vitest run`
- `pnpm seed` — `tsx scripts/seed-osm.ts`
- `pnpm verify:skills` — `diff -ru .agents/skills .claude/skills`
- `pnpm verify` — `pnpm verify:skills && pnpm lint && pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test && pnpm build`
<!-- repo-map:auto:end -->

## Runtime boundaries

<!-- 手書き: entrypoints / background jobs / migrations / 外部 API 呼び出し箇所 -->

- entrypoints:
- 外部 API:
- cron / background:

## Change hotspots（手書き・最重要）

<!-- ここが「未来の AI が同じ事故を繰り返さないための」一次装置。
     壊れやすい箇所・過去に事故った箇所・テストが薄い箇所を、
     事故が起きるたびに追記する。削除は事故要因が構造的に消えたときだけ。 -->

| 場所 | 何が壊れやすいか / 過去に何があったか |
|---|---|
| （例: `lib/auth/**`） | （例: セッション検証を middleware に寄せた経緯。route 側に再実装しない） |

## Security-sensitive（手書き）

<!-- ここに載っている領域に触れる変更は review-pre / review-post が必須 -->

- 認証・認可:
- 秘密情報の読み書き:
- 課金:
- データ削除・migration:
