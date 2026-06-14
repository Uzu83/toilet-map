# #1: 未レビュートイレの段階的 indexable 化 — review_count > 0 ゲートの鶏卵問題を解く

> `/dev-init 1` 生成の進捗管理表。`/dev-resume` はここを読んで現在位置を特定する。文脈は会話でなくこのファイルに持たせる。設計の正は `docs/design/ISSUE-1-design.md`。

## 基本情報

| 項目 | 内容 |
|---|---|
| GitHub Issue | #1 |
| Notion 設計書 | https://app.notion.com/p/37e1ef8488d581a9a90def954873341d |
| ローカル設計書 | `docs/design/ISSUE-1-design.md`（source of truth） |
| テストパターン | `docs/progress/TESTS-1.md`（正常/異常/境界/回帰） |
| ブランチ | feature/1 |
| 開始日 / 目標完了日 | 2026-06-14 / 未定 |
| 最終更新 | 2026-06-14 16:xx JST（5.6 完了・本番反映 smoke 合格・Issue #1 クローズ可） |

---

## 要件サマリー

### 背景・目的
起点コミット `83e63ee` で `isToiletIndexable(t)=review_count>0` を indexable ゲートにし、ISR Writes 806K/200K の Hobby 突破を止めた。副作用 = 鶏卵問題（検索流入なし→レビュー付かない→永遠に noindex）。~80k のうち SEO 入口になり得るのがごく一部。**クローラ予算を Hobby 内に保ったまま indexable 母集団を品質シグナルで広げる**。

### 受入条件
- [ ] AC1: `isToiletIndexable(t)` に `review_count` 以外の品質シグナル（named OSM）を追加し、indexable 件数を意図レンジに収める。
- [ ] AC2: 追加後の sitemap 行数を試算し ISR Writes 月予算（Hobby 200K/月）想定内であることを PROGRESS または README に記録（§4.4 の式 + 実測 N + 想定 Writes）。
- [ ] AC3: `sitemapChunkCount()` 閾値（`SITEMAP_CHUNK_TOILETS=11,000`）の根拠を記録（Google 上限 50,000 / 4 locale = 12,500、余裕で 11,000）。
- [ ] AC4: 既存の公開対象トイレ（`review_count > 0` **かつ** `not_a_toilet_count < 5`）が indexable / sitemap から落ちないこと。`not_a_toilet_count >= 5` は現状も `notFound()` 済で保護対象外。

### スコープ
- **対象**: `isToiletIndexable` 述語拡張 / migration 007（indexable RPC + index）/ sitemap 用サーバ関数 / `sitemapChunkCount` 動的化 / sitemap id>=1 復活 / vitest 基盤 + 真理値表テスト / AC2 予算記録。
- **対象外（Phase 2+）**: 認証付き投稿フロー / AdSense 配信最適化 / 新規ピン追加 UI。

---

## 採用方針（人間判断 2026-06-14）— canonical predicate（§5.1）

```
INDEXABLE(t) := not_a_toilet_count < 5
             AND ( review_count > 0
                   OR ( source = 'osm' AND NAMED(t) ) )

NAMED(t): SQL = (name IS NOT NULL AND name ~ '[^[:space:]]')   // POSIX [:space:]。btrim ではない(trim/btrim 差分回避, §5.1/Step8-P1)
          TS  = ((name?.trim().length ?? 0) > 0)   // 空白のみ名 → false
```
真理値表は §5.2（テスト進捗の 9 ケース T1–T9。vitest は 16 ケースで網羅）。SQL（007）と TS（`isToiletIndexable`）は必ずこの定義に一致。

---

## 実測結果（Task 1.1, 2026-06-14 prod 実測 / read-only）

prod Supabase（`ijsftemvtnfvqemjbrxc`）を INACTIVE→restore（無料復帰）後、`toilet_stats`(003) 適用済を確認のうえ 1 本の集計で取得。

| 指標 | 値 | 備考 |
|---|---|---|
| total | 80,450 | |
| osm / inferred / user / other | 31,269 / 49,181 / 0 / 0 | source 分布 |
| named_osm（`source='osm' and name ~ '[^[:space:]]'`） | **1,428** | 新シグナル母集団 |
| named_osm_rich（+ opening_hours/amenity あり） | 454 | リッチ弁の予備値 |
| reviewed（review_count>0） | 6 | 既存 indexable |
| not_a_toilet_count ≥ 5 | 0 | AC4 保護対象外は現状ゼロ |
| **n_indexable（base canonical predicate）** | **1,434** | = named_osm 1,428 + reviewed のうち named_osm 外 6 |
| n_indexable_rich（参考・リッチ版） | 460 | 採用せず |

## ゲート判定（Task 1.2）— 採用 predicate 確定

- **chunk_count = 1 + ceil(1,434 / 11,000) = 2**（チャンク0=静的+area / チャンク1=トイレ 1,434×4 locale）
- **月間 ISR Writes(toilet) ≈ N × L × max(D,1) = 1,434 × 4 × D**
  - D=1: **5,736** / D=2: **11,472** / D=4: **22,944**
  - §4.3 許容（120K toilet 枠から逆算）: D=1≤30,000 / D=2≤15,000 / D=4≤7,500。
  - D=1・D=2 は余裕で内。D=4 の絶対値 22,944 も 120K 枠・200K 月予算に対し約 11.5% で予算内。
- **判定 = 予算超過なし → named OSM 固定（base predicate）で確定。リッチ条件は追加しない。**
- → canonical predicate は §5.1 のまま改訂なし。3.1 / 2.1 / 2.2 / 4.2 の期待値は設計書 §5.2 真理値表のまま確定（ゲートによる改訂タスクは発生せず）。

---

## コードベース調査結果

### 直接修正対象ファイル
| パス | 役割 | 修正内容 |
|---|---|---|
| `src/lib/toiletSeo.ts` | indexable ゲート純関数 | `isToiletIndexable` を canonical predicate 化（現 L29-31）。`isToiletUnconfirmed` は据置 |
| `supabase/migrations/007_seo_indexable.sql` | 新規 | `toilet_ids_indexable_page` / `toilet_indexable_count` RPC + 部分 index + grant |
| `src/lib/toilets.ts` | SEO サーバ読み取り | `getIndexableToiletIdsPage` / `getIndexableToiletCount` 追加（1000行ページング踏襲、既存 L96-122/L81-90 参考）。既存 2 関数は温存 |
| `src/lib/sitemapChunks.ts` | チャンク数共有 | `sitemapChunkCount()` 動的化 = `1 + ceil(indexableCount/11000)`（現 L12-14） |
| `src/app/sitemap.ts` | sitemap 生成 | id>=1 ブランチ復活、`getIndexableToiletIdsPage` へ差し替え（現 L57-70） |
| `package.json` / `vitest.config.ts` | テスト基盤 | vitest 未導入 → devDep + `"test":"vitest run"` + config（`@/*` を tsconfig と一致） |
| `docs/progress/PROGRESS-1.md` / `README.md` | 予算記録 | §4.4 予算試算（AC2） |

### 参照・影響範囲ファイル（確認のみ・コード変更なし想定）
| パス | 役割 | 影響 |
|---|---|---|
| `src/app/robots.ts` | robots.txt | `sitemapChunkCount()` 共有で自動追従（L21）。確認のみ |
| `src/app/[locale]/toilet/[id]/page.tsx` | 個別ページ | `isToiletIndexable` 経由で robots 自動変化（L67）。`not_a_toilet>=5` は L53/L79 で notFound（二重ガード無害）。確認のみ |
| `supabase/migrations/005,006,003,001` | 既存 RPC/ビュー | 列形・命名・`toilet_stats`(003 形) を 007 で踏襲。書き換えない |
| `src/types/toilet.ts` | Toilet 型 | 全カラム既存（name/source/review_count/not_a_toilet_count）。変更なし |

### 既存実装の参考箇所
| 参考ファイル | 行 | 参考内容 |
|---|---|---|
| `src/lib/toilets.ts` | L92-122 | PostgREST 1000行内部ページング（`getIndexableToiletIdsPage` の雛形） |
| `supabase/migrations/006_seo_rpcs_fast.sql` | L13-29 | RPC 列形 `(id,created_at)` / grant / `toilets_created_at_idx` |
| `supabase/migrations/005_seo_rpcs.sql` | L11-29 | `toilet_stats` join + `coalesce(...not_a_toilet)<5` 述語形 |
| `supabase/migrations/003_not_a_toilet_reports.sql` | L11-21 | `toilet_stats` の review_count/not_a_toilet_count 定義 |

---

## 詳細タスク一覧

ステータス凡例: ⬜未着手 🔄進行中 ✅完了 ⏸️保留 ❌中止

### フェーズ0: 起点
| # | タスク | 状態 | 対象ファイル | 実装詳細 |
|---|---|---|---|---|
| 0.1 | feature/1 ブランチ作成・起点確認 | ✅ | — | feature/1 在中、main と同一地点（設計4ファイルのみ）。実装コミットなし |

### フェーズ1: 準備・実測（gate）
| # | タスク | 状態 | 対象ファイル | 実装詳細 |
|---|---|---|---|---|
| 1.1 | prod 実測 SQL（read-only） | ✅ | （上記「実測結果」セクションに記録） | 2026-06-14 restore 後実測。**n_indexable=1,434**（named_osm 1,428 / reviewed 6 / not_a_toilet≥5=0）。`toilet_stats`(003) 適用済確認・migration には入れていない |
| 1.2 | **採用 predicate 確定ゲート**（N→chunk_count・予算試算） | ✅ | （上記「ゲート判定」セクション） | **N=1,434 / chunk_count=2 / D=1:5,736・D=2:11,472・D=4:22,944**。予算超過なし → **named OSM 固定（base predicate）で確定、リッチ条件追加なし**。canonical 改訂タスクは発生せず（3.1/2.x/4.2 は §5.2 のまま） |

### フェーズ2: 実装（DB）
| # | タスク | 状態 | 対象ファイル | 実装詳細 |
|---|---|---|---|---|
| 2.1 | `toilet_ids_indexable_page` RPC | ✅ | `supabase/migrations/007_seo_indexable.sql` | `(id uuid, created_at timestamptz)`、`toilet_stats` join + canonical WHERE、`order by created_at,id`、`create or replace`、default `(0,1000)` |
| 2.2 | `toilet_indexable_count` RPC | ✅ | 同上 | `count(*)` + canonical WHERE。`returns bigint` |
| 2.3 | 部分インデックス | ✅ | 同上 | `create index if not exists toilets_named_osm_idx on toilets(created_at,id) where source='osm' and name ~ '[^[:space:]]'`（§5.1 正規化に一致）。**コメント: この index は named OSM branch 用。OR 全体（review>0 経路）は保証しない**（Step8-P1-3） |
| 2.4 | grant + ヘッダコメント | ✅ | 同上 | `grant execute ... to anon, authenticated`、新ファイル方針・join 再導入理由・canonical 一致を明記 |

### フェーズ3: 実装（App / sitemap）
| # | タスク | 状態 | 対象ファイル | 実装詳細 |
|---|---|---|---|---|
| 3.1 | `isToiletIndexable` canonical 化 | ✅ | `src/lib/toiletSeo.ts` | §5.1 純関数。`not_a_toilet<5` を含める（robots と sitemap RPC の真理値表完全一致 = R1 防止）。NAMED は `name?.trim()`（§5.1、SQL の `~ '[^[:space:]]'` と同値に保つ）。コメント更新。**base predicate で先行着手可、ただし 1.2 完了まで deploy/merge 不可**（Step8-P1-4）。1.2 が予算超過を検出したらリッチ条件を反映して改訂 |
| 3.2 | `getIndexableToiletCount` | ✅ | `src/lib/toilets.ts` | 新 RPC `toilet_indexable_count` 呼出、失敗時 0。既存 `getToiletCount`（dead code）は温存 |
| 3.3 | `getIndexableToiletIdsPage` | ✅ | `src/lib/toilets.ts` | 新 RPC `toilet_ids_indexable_page`、1000行ページング踏襲。既存 `getToiletIdsPage` 温存 |
| 3.4 | `sitemapChunkCount` 動的化 | ✅ | `src/lib/sitemapChunks.ts` | `1+ceil(count/11000)`、count=0→1。`getIndexableToiletCount` 呼出。コメント更新。**注意（Step8-P1-2）: count 取得失敗時 0 fallback のため build は通り 1 チャンク固定になる。`generateSitemaps` はビルド時確定で自動回復しないので、build 時に期待 N>0 なのに 0 なら deploy しない（5.1 で確認）** |
| 3.5 | sitemap id>=1 復活 | ✅ | `src/app/sitemap.ts` | L60 を `getIndexableToiletIdsPage` に、L5 import 差替、L13-18 コメント更新。チャンク0 無変更 |
| 3.6 | robots / toilet ページ自動追従の確認 | ✅ | `src/app/robots.ts` / `toilet/[id]/page.tsx` | コード変更なし。共有関数経由の追従を目視確認 |

### フェーズ4: テスト
| # | タスク | 状態 | 対象ファイル | テスト観点 |
|---|---|---|---|---|
| 4.1 | vitest 基盤スキャフォールド | ✅ | `package.json` / `vitest.config.ts` | vitest devDep + `"test":"vitest run"` + `@/*` 解決。4.2 の前提 |
| 4.2 | `isToiletIndexable` 単体テスト | ✅ | `src/lib/toiletSeo.test.ts`(新規) | §5.2 真理値表 9 ケース全網羅（T9 空白名=trim/btrim 差分）+ R3 の 2 分割（reviewed+inferred+unnamed=true / reviewed+not_a_toilet=5=false）。**期待値は 1.2 の採用 predicate 確定後に確定**（Step8-P1-4）。完了条件 = 4.4 で全ケース green |
| 4.3 | SQL 述語との同値検証 | ✅ | 計測メモ + テストヘッダコメント | 007 apply 後に SQL Editor で §5.2 同表を再現。`toilet_indexable_count()` == 実測 n_indexable、`count(ids_page)`==count、列形確認。**`explain (analyze)` は index 使用だけでなく `toilet_ids_indexable_page(0,1000)` と中間 offset の実行時間も見る。悪ければ 2.1 を union 分割（review>0 経路 / named-osm 経路）に変える fallback を検討**（Step8-P1-3） |
| 4.4 | 検証コマンド実行 | ✅ | （結果を 5.5 に供給） | `npm run test`（4.2 が green）→ `npm run lint` → `npm run build` を実行し pass/fail を記録。1 つでも失敗なら実装に戻る |

### フェーズ5: レビュー・完了
| # | タスク | 状態 | 備考 |
|---|---|---|---|
| 5.1 | 適用順序の実行（007 apply → 疎通 → build → deploy → smoke） | ✅ | **逆順禁止**。①007 apply 済 →②疎通 `toilet_indexable_count()`=1,434 →③build chunk=2 →④deploy（マージ後 lockfile 不整合で一旦 ERROR、課題7 で修正後 `8b2c866` が READY）→⑤smoke 合格（robots に 0/1 両チャンク列挙・`/sitemap/1.xml` に 5,736 トイレ URL=1,434×4・indexable ページ `index,follow`）。2026-06-14 完了 |
| 5.2 | AC2 予算記録（1.2 成果物を転記して完了） | ✅ | 1.2 の成果物（実測 N / chunk_count / D=1,2,4 Writes / 採用判定）を本ファイル/README に転記。**§4.4 全項目を明記**: `static_rows(20)` + `area_rows(|areaSlugs|×4)` + `toilet_rows(N×4)`、固定 ISR 分（sitemap `chunk_count×~30/月`、area `area_pages×~4/月`）、閾値 11,000 根拠、R4 注記 |
| 5.3 | セルフレビュー | ✅ | canonical TS/SQL 一致(三点 grep 確認)・scope 逸脱なし・公開表記ポリシー・新規env なし。Codex でも担保 |
| 5.4 | /codex:review（差分） | ✅ | codex 0.139/gpt-5.5。2サイクルで収束。サイクル1 P1×1(PROGRESS記述)採用・修正、実装は承認。サイクル2 収束(P0/P1なし) |
| 5.5 | PR 作成 | ✅ | [PR #3](https://github.com/Uzu83/toilet-map/pull/3)。`Closes #1`・AC1-4チェック・検証結果記載。commit 8bf1d62 |
| 5.6 | マージ + 再デプロイ（チャンク数確定） | ✅ | PR #3 マージ済（merge `fa3a75e`）。マージ後デプロイは lockfile 不整合で ERROR → 課題7 を `8b2c866` で修正 → 本番 `8b2c866`/READY で chunk=2 確定。smoke 合格（2026-06-14）。R4: 今後の大規模シード後はチャンク数再確定のため再デプロイ要 |

---

## テスト進捗（§5.2 真理値表 = 回帰の最小セット）

| # | source | name | review | not_a_toilet | 期待 | 分類 | 状態 |
|---|---|---|---|---|---|---|---|
| T1 | inferred | null | 3 | 0 | ✅true | 回帰(AC4保護) | ✅TS |
| T2 | osm | "X" | 2 | 5 | ❌false | 異常(除外) | ✅TS |
| T3 | osm | "博多駅前" | 0 | 0 | ✅true | 正常(新シグナル) | ✅TS |
| T4 | osm | "   " | 0 | 0 | ❌false | 境界(空白名) | ✅TS |
| T5 | osm | null | 0 | 0 | ❌false | 正常(無名落とす) | ✅TS |
| T6 | user | null | 0 | 0 | ❌false | 正常(対象外) | ✅TS |
| T7 | inferred | "○○モール" | 0 | 0 | ❌false | 正常(inferred除外) | ✅TS |
| T8 | osm | "X" | 0 | 4 | ✅true | 境界(not_a_toilet=4<5 直前) | ✅TS |
| T9 | osm | "\t" | 0 | 0 | ❌false | 境界(空白名 trim/btrim 差分) | ✅TS |

> 状態 `✅TS` = vitest TS 単体（16ケース全 green、T1–T9 を N/E/B/R で網羅）で確認済。**SQL 側同値（4.3）も 007 apply 後に prod で確認済**: `toilet_indexable_count()`=1,434（実測 N 一致）/ ページャ件数・distinct 一致 / U+3000・タブ・改行・半角空白すべて SQL `[:space:]`=空白扱いで **TS の trim() と完全一致（実データ乖離 0 行）**。課題5 クローズ。

| 分類 | 総数 | Pass(TS) | Fail | SQL同値(4.3) |
|---|---|---|---|---|
| 正常系 | 4 | 4 | 0 | ✅ |
| 異常系 | 1 | 1 | 0 | ✅ |
| 境界値 | 3 | 3 | 0 | ✅ |
| 回帰 | 1 | 1 | 0 | ✅ |

---

## 作業ログ

### 2026-06-14（その6 — 5.6 完了: lockfile 不整合の修復 + 本番反映 smoke）
- **/dev-resume で現在位置確定**: PR #3 は **MERGED 済**（merge `fa3a75e`）。だが本番 smoke で `/sitemap/1.xml`=404・robots に chunk0 のみ → 退行を検知。
- **真因（課題7・新規ブロッカー）**: Vercel デプロイログ調査で、マージ後の3デプロイ（`fa3a75e`/`4842c15`/`8bf1d62`）が全て **ERROR**。本番 READY は Issue #1 *前*の旧コミット `83e63ee`（review>0 ゲート）だった。エラー = `ERR_PNPM_OUTDATED_LOCKFILE`。4.1 で vitest を `npm install` 追加したため **package-lock.json だけ更新され、Vercel が優先する pnpm-lock.yaml が stale**（vitest なし）→ `frozen-lockfile` で install 失敗。Issue #1 の機能はこの時点まで一度も本番に出ていなかった。
- **修正（覇王判断「pnpm に統一」）**: main で `pnpm install` し pnpm-lock.yaml を vitest@^4.1.8 込みに再生成 + 乖離した package-lock.json 削除（projects 全体ルール=pnpm 必須に準拠）。ローカル検証 `pnpm test` 16/16 / `pnpm lint` clean / `pnpm build` success（chunk=2 確認）。main 直 push `8b2c866`。
- **再デプロイ + smoke（5.6/5.1④⑤）**: 新デプロイ `dpl_6VPj…` READY。`/robots.txt` に 0/1 両チャンク列挙・`/sitemap/1.xml` に **5,736 トイレ URL**（=1,434×4 locale, 実測 N 一致）・indexable トイレページ `<meta name="robots" content="index, follow">` を確認。
- **進捗**: 5.1✅ / 5.6✅ / 課題7 クローズ。**Issue #1 全 AC 充足・本番反映完了（20/20）。** 残・別件: GSC を新 URL `toilet-map-six` で再登録 + インデックス再申請（Issue #1 外）。

### 2026-06-14（その5 — 5.1 適用ゲート: 007 prod apply + 4.3 SQL同値）
- **007 apply（覇王承認）**: Supabase MCP `apply_migration` で prod に 007 適用（新規 RPC 2本 + 部分 index、冪等、既存破壊なし）。
- **疎通（5.1 ②）**: `toilet_indexable_count()`=**1,434**（実測 N 一致）/ `toilet_ids_indexable_page(0,大)` 件数 1,434・distinct 1,434（ページャ健全）/ first_page_5=5。SQL1/SQL2/SQL3 green。
- **build（5.1 ③）**: chunk=**2**（`/sitemap/0.xml` + `/sitemap/1.xml`）確認。apply 前の 1 → 2 に復活。
- **4.3 SQL 同値完結**: prod 実値で U+3000・タブ・改行・半角空白すべて SQL `[:space:]`=空白扱い → **TS の trim() と完全一致、乖離 0 行**。SQL4 green、課題5 クローズ。
- **AC2/AC3 証跡（5.2）**: README に「SEO: indexable ゲートと ISR 予算」節を追加（canonical predicate / N=1,434 / 月Writes 5,736–22,944 / chunk=2 / 11,000 根拠 / apply 順序）。migration 一覧に 005–007 を補完。
- **進捗**: 4.3✅ / 5.1🔄（①②③済、④deploy⑤smoke はマージ後）/ 5.2✅。実装 19/20。**残: 5.5 PR（Closes #1）/ 5.6 マージ後再デプロイ・smoke**。

### 2026-06-14（その4 — Codex 差分レビュー 2サイクル収束 + Vercel 復旧）
- **Codex レビュー（手順4）**: codex-cli 0.139 / gpt-5.5 / `-s read-only`。
  - サイクル1: **P1×1**（PROGRESS:43 の canonical が旧 `btrim(name)<>''` のままで §5.1/007 SQL の regex 版と自己矛盾、件数表記「7ケース」不一致）。**実装差分は P0/P1 なしで承認**（toiletSeo / 007 RPC predicate / sitemap 差替 / chunk 根拠 / AC4 reviewed 維持）。
  - 採否: **P1 採用** → PROGRESS L43 を `name ~ '[^[:space:]]'` に、件数を「9ケース T1–T9（vitest 16）」に修正。`btrim` 述語残存ゼロ・§5.1/007/PROGRESS 三点一致を grep 自己検証。
  - サイクル2: **収束（P0/P1 なし）**。P1 解消確認 + 実装再精査（AC4 退行なし・`security definer`/grant 既存同形・TS/SQL 真偽一致、U+3000 のみ apply 後実値確認）。P2未満の `robots.ts` 古コメント「現状は1」を動的版に追従修正。
- **Vercel 復旧（並行）**: プロジェクト削除済 → GitHub `Uzu83/toilet-map`(main) 再 Import で復旧、env 4本再設定（secret 2本 Sensitive）、Supabase restore、Deployment Protection Disabled。**本番 URL = https://toilet-map-six.vercel.app**（旧 -beta 失効）。smoke 全 200。Notion ハブ/ページも -six に更新済（GSC は新URLで再登録要）。
- **進捗サマリ**: フェーズ5 のうち 5.3（セルフ+Codex で担保）・5.4（Codex 2サイクル収束）✅。実装 18/20。**残: 5.1 適用ゲート（007 prod apply、覇王承認）/ 4.3 SQL同値 / 5.2 AC2 を README へ転記 / 5.5 PR / 5.6 マージ後再デプロイ**。

### 2026-06-14（その3 — 実装フェーズ 並列実装 + 統合検証）
- **実施**: /dev-resume 並列開発モードで 3 グループ（coder ×3）に分割実装 — ①App（3.1 toiletSeo canonical 化 + 3.2/3.3 toilets.ts の getIndexable* + 3.4 sitemapChunks 動的化 + 3.5 sitemap id≥1 復活、3.6 robots/page 自動追従確認）②DB（2.1-2.4 migration 007: RPC 2本 + 部分index + grant）③Test（4.1 vitest 基盤 + 4.2 真理値表 16ケース）。別ファイル群で競合なし。
- **統合検証（4.4）**: `npm run test` 16/16 green / `npm run lint` clean / `npm run build` success。import・型整合 OK。
- **既知の想定挙動**: build 時点で 007 が prod 未適用のため `toilet_indexable_count`→0 fallback で sitemap は 1 チャンク（`/sitemap/0.xml` のみ）。これは F4/5.1 で想定済。**007 apply 後の build で chunk=2 になる（5.1 ゲート厳守、逆順 deploy 禁止）**。
- **env 確認（覇王指示）**: 変更4ファイルに新規 `process.env`/`NEXT_PUBLIC` 参照ゼロ。新 RPC は既存 `getServerSupabasePublishable()` 流用 → **Vercel env 変更不要**。
- **進捗サマリ**: フェーズ2（2.x）✅ / フェーズ3（3.x）✅ / フェーズ4（4.1・4.2・4.4）✅。実装タスク 16/20（残: 4.3 SQL同値・5.x レビュー/apply/PR）。
- **次**: Codex 差分レビュー（手順4）→ 5.1 適用ゲート（007 apply→疎通→build→deploy→smoke）→ PR。

### 2026-06-14（その2 — /dev-resume フェーズ1 実測ゲート）
- **実施**: /dev-resume で現在位置確定（実装 0/20、feature/1 は main 同一地点）。フェーズ1 着手。prod Supabase が INACTIVE のため restore（無料復帰、ユーザ明示承認）→ ACTIVE_HEALTHY 復元後に `toilet_stats`(003) 適用済を確認 → 1.1 集計 SQL（read-only）を実行。
- **実測結果**: total 80,450 / osm 31,269 / inferred 49,181 / named_osm 1,428 / reviewed 6 / not_a_toilet≥5=0 / **n_indexable=1,434**（リッチ版 460）。
- **ゲート判定（1.2）**: chunk_count=2、月 Writes(toilet) D=1:5,736〜D=4:22,944 で予算内 → **named OSM 固定（base predicate）で確定、リッチ条件不要**。canonical 改訂タスク発生せず。
- **進捗サマリ**: フェーズ0（0.1）✅ / フェーズ1（1.1・1.2）✅。実装タスク 2/20。次は実装フェーズ（3.1/4.1〜）。
- **ブロッカー**: 解消（prod resume 済、課題1 クローズ）。

### 2026-06-14
- **実施**: /dev-init 1 を Step 0→8 まで順序実行。Step 5 Codex 設計書レビュー（P0×1/P1×2/P2×2 全採用）を設計書 §2-§9 に反映。Step 6 で並列サブエージェント 2 本（DB / App+test）でタスク分解 → 本ファイル生成。Step 7 Codex タスク分解レビュー（P0 なし/P1×3/P2×3 全採用）反映: フェーズ0新設、1.2 gate 化、4.4 追加、5.2 強化、T8 追加。Step 8 Codex 実装方針レビュー（P0 なし/P1×4 全採用）反映: NAMED 正規化を `~ '[^[:space:]]'` に（trim/btrim 差分）+T9、5.1 を疎通→build→deploy→smoke に具体化、2.3 index コメント+4.3 explain 実時間、3.1 を「1.2 完了まで deploy/merge 不可」。
- **進捗サマリ**: 設計確定・タスク分解確定（Step7/8 反映済）・テストパターン生成（Step9, TESTS-1.md）。/dev-init 全 Step（0→10）完了。実装タスク 0/20。
- **ブロッカー**: なし（実測 1.1 は prod paused 可能性のみ）

---

## 作業再開ガイド

- **最終作業タスク**: 5.6 完了（PR #3 マージ後の lockfile 不整合=課題7 を `8b2c866` で修復 → 本番再デプロイ READY → smoke 合格）。**Issue #1 完了（20/20）。**
- **中断理由**: なし。Issue #1 はクローズ可能（受入条件 AC1–AC4 充足・本番 chunk=2 で indexable 5,736 URL 反映済）。
- **次のアクション（Issue #1 外）**: ①GitHub Issue #1 を Close（PR #3 が `Closes #1` なのでマージで自動クローズ済の可能性大、要確認）。②GSC を新 URL `toilet-map-six` で再登録 + sitemap 送信 + インデックス再申請。③R4 リマインド: 今後の大規模シード後は `sitemapChunkCount()` 再確定のため再デプロイ。

### 再開コマンド
```bash
# main 在中。Issue #1 本番反映済（8b2c866 / chunk=2）。
git log --oneline -3
curl -s https://toilet-map-six.vercel.app/robots.txt | grep -i sitemap  # 0/1 両チャンク確認
```

---

## メモ・課題

### 未解決課題
| # | 課題 | 優先度 | メモ |
|---|---|---|---|
| 1 | ~~prod Supabase が paused → 実測 1.1 がブロック~~ | — | ✅解消: 2026-06-14 restore→ACTIVE_HEALTHY、1.1 実測完了 |
| 2 | Vercel「デプロイが on-demand ISR を無効化するか」(D 係数) 要公式確認 | 低 | 実測 N=1,434 なら D=4 でも 22,944/月 で予算内 → D 係数の影響は小。Vercel Usage で実測継続。断言しない |
| 3 | vitest 未導入・`test`/`check` script 不在 | 中 | 4.1 で test 基盤追加。`check` の要否はメイン判断 |
| 4 | migration 007 適用とコード deploy の順序ハザード | 高 | 5.1：007 apply → 疎通 → build → deploy → smoke。逆順で sitemap 1 チャンク固定（退行・自動回復しない） |
| 5 | ~~TS `trim()` と SQL `btrim()` 非同値~~ | — | ✅解消: SQL を `name ~ '[^[:space:]]'` に統一。prod 実値で U+3000/タブ/改行/半角空白すべて TS と一致、乖離 0 行確認（4.3） |
| 6 | Next 16 `generateSitemaps` の docs 未確認（node_modules 未 install） | 低 | `npm install` 後に `node_modules/next/dist/docs/` で sitemap/ISR 仕様を再確認（AGENTS.md 指示） |
| 7 | ~~lockfile 二重化（package-lock.json + pnpm-lock.yaml）でマージ後デプロイ全 ERROR~~ | — | ✅解消: 4.1 で vitest を `npm install` 追加し package-lock のみ更新 → Vercel 優先の pnpm-lock が stale で `ERR_PNPM_OUTDATED_LOCKFILE`。`pnpm install` で pnpm-lock 再生成 + package-lock 削除し pnpm 単一運用に統一（`8b2c866`）。本番 READY・chunk=2・smoke 合格 |

### 決定事項
| 日付 | 決定 | 理由 |
|---|---|---|
| 2026-06-14 | 実測 N=1,434 で named OSM 固定（base predicate）確定、リッチ条件不採用 | chunk=2・月Writes最悪22,944 で 200K 予算に余裕。リッチ版 460 まで絞る必要なし |
| 2026-06-14 | signal = named OSM + review維持、inferred 除外 | 実トイレ named=情報量多くthin回避。inferred は実物非特定UX + isToiletUnconfirmed と矛盾 |
| 2026-06-14 | `not_a_toilet<5` を TS 純関数にも含める | robots と sitemap RPC の真理値表を完全一致（R1 防止）。page の notFound と二重ガードだが無害 |
| 2026-06-14 | 既存 `getToiletCount`/`getToiletIdsPage` は温存（差し替えず新関数追加） | dead code だが新ファイル方針・回帰回避。整理は別 PR |
