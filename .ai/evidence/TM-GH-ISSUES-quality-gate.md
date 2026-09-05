# quality-gate — TM-GH-ISSUES

- 実行: 2026-09-06
- リポジトリ: /Users/toshiki/development/projects/toilet-map
- ブランチ: auto/fix-github-issues-2026-09-06

| ステップ | コマンド | 結果 |
|---|---|---|
| lint | `pnpm lint` | pass（vendor の既存 warning 1 件のみ） |
| typecheck | `pnpm exec tsc --noEmit` | pass（FEATURED_AREA_SLUGS を areas.ts へ移して page export 禁止を解消） |
| test | `pnpm test` | pass 265 / 23 files |
| build | `pnpm build` | pass |

**静的検証: 全て pass**（要求達成の証明ではない。受入は verifier / ブラウザ）
