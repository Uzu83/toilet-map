# STATE — toilet-map

writer: Orchestrator のみ

## current
- task: none (idle)
- branch: main (`b37ff8d`)
- status: idle
- date: 2026-09-06

## invariants（他セッション必読）
- **main 自動デプロイ ON**（2026-09-06 / PR #38）: `vercel.json` の `git.deploymentEnabled.main=true`。**main への merge = 本番デプロイ**。
- migration 依存の変更は **merge より先に** ①Supabase 手動適用 → ②smoke → ③merge。未適用 merge は RPC 不在 500。
- 詳細は `CLAUDE.md` の「Supabase 運用」と「地雷マップ」。
- 本番 URL: https://toilet-map-six.vercel.app

## recent
- 2026-09-06: PR #37 merged — GitHub Issue #27/#28/#29/#30/#31/#32/#34/#35/#36 修正（#33 は仕様どおり未対応）
- 2026-09-06: PR #38 merged — main 自動デプロイ ON。本番 `dpl_53YmB77dDvcsAz74Qrki2QDfM3nn` READY（Issue 修正含む）

## next
- 特になし。次タスクは新規契約（`.ai/tasks/<ID>.yaml`）から。
