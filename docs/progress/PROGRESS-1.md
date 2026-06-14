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
| 最終更新 | 2026-06-14 03:1x JST（Step 6 完了時点） |

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

NAMED(t): SQL = (name IS NOT NULL AND btrim(name) <> '')
          TS  = ((name?.trim().length ?? 0) > 0)   // 空白のみ名 → false
```
真理値表は §5.2（テスト進捗の 7 ケース）。SQL（007）と TS（`isToiletIndexable`）は必ずこの定義に一致。

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
| 0.1 | feature/1 ブランチ作成・起点確認 | ⬜ | — | `git checkout -b feature/1`、`git status` クリーン確認、main から分岐 |

### フェーズ1: 準備・実測（gate）
| # | タスク | 状態 | 対象ファイル | 実装詳細 |
|---|---|---|---|---|
| 1.1 | prod 実測 SQL（read-only） | ⬜ | （計測メモ / PR 説明、migration に入れない） | total/osm/inferred/user/named_osm/named_osm_rich/reviewed/not_a_toilet(>=5)/**n_indexable** を 1 本の集計で取得。`toilet_stats`(003) 適用確認を先に。free tier paused なら resume 後 |
| 1.2 | **採用 predicate 確定ゲート**（N→chunk_count・予算試算） | ⬜ | （成果物を 5.2 に供給） | **成果物 = 実測 N / chunk_count=1+ceil(N/11000) / D=1,2,4 の月 Writes / 採用判定メモ**。`月Writes(toilet)≈N×4×max(D,1)` を §4.3 許容表（30k/15k/7.5k）と突合。**N が予算超過した場合は named_osm_rich のリッチ条件を canonical predicate に追加し、3.1 / 2.1 / 2.2 / 4.2 / 4.3 を更新してから実装**（=これがゲート）。超過しなければ named OSM 固定で進む |

### フェーズ2: 実装（DB）
| # | タスク | 状態 | 対象ファイル | 実装詳細 |
|---|---|---|---|---|
| 2.1 | `toilet_ids_indexable_page` RPC | ⬜ | `supabase/migrations/007_seo_indexable.sql` | `(id uuid, created_at timestamptz)`、`toilet_stats` join + canonical WHERE、`order by created_at,id`、`create or replace`、default `(0,1000)` |
| 2.2 | `toilet_indexable_count` RPC | ⬜ | 同上 | `count(*)` + canonical WHERE。`returns bigint` |
| 2.3 | 部分インデックス | ⬜ | 同上 | `create index if not exists toilets_named_osm_idx on toilets(created_at,id) where source='osm' and name ~ '[^[:space:]]'`（§5.1 正規化に一致）。**コメント: この index は named OSM branch 用。OR 全体（review>0 経路）は保証しない**（Step8-P1-3） |
| 2.4 | grant + ヘッダコメント | ⬜ | 同上 | `grant execute ... to anon, authenticated`、新ファイル方針・join 再導入理由・canonical 一致を明記 |

### フェーズ3: 実装（App / sitemap）
| # | タスク | 状態 | 対象ファイル | 実装詳細 |
|---|---|---|---|---|
| 3.1 | `isToiletIndexable` canonical 化 | ⬜ | `src/lib/toiletSeo.ts` | §5.1 純関数。`not_a_toilet<5` を含める（robots と sitemap RPC の真理値表完全一致 = R1 防止）。NAMED は `name?.trim()`（§5.1、SQL の `~ '[^[:space:]]'` と同値に保つ）。コメント更新。**base predicate で先行着手可、ただし 1.2 完了まで deploy/merge 不可**（Step8-P1-4）。1.2 が予算超過を検出したらリッチ条件を反映して改訂 |
| 3.2 | `getIndexableToiletCount` | ⬜ | `src/lib/toilets.ts` | 新 RPC `toilet_indexable_count` 呼出、失敗時 0。既存 `getToiletCount`（dead code）は温存 |
| 3.3 | `getIndexableToiletIdsPage` | ⬜ | `src/lib/toilets.ts` | 新 RPC `toilet_ids_indexable_page`、1000行ページング踏襲。既存 `getToiletIdsPage` 温存 |
| 3.4 | `sitemapChunkCount` 動的化 | ⬜ | `src/lib/sitemapChunks.ts` | `1+ceil(count/11000)`、count=0→1。`getIndexableToiletCount` 呼出。コメント更新。**注意（Step8-P1-2）: count 取得失敗時 0 fallback のため build は通り 1 チャンク固定になる。`generateSitemaps` はビルド時確定で自動回復しないので、build 時に期待 N>0 なのに 0 なら deploy しない（5.1 で確認）** |
| 3.5 | sitemap id>=1 復活 | ⬜ | `src/app/sitemap.ts` | L60 を `getIndexableToiletIdsPage` に、L5 import 差替、L13-18 コメント更新。チャンク0 無変更 |
| 3.6 | robots / toilet ページ自動追従の確認 | ⬜ | `src/app/robots.ts` / `toilet/[id]/page.tsx` | コード変更なし。共有関数経由の追従を目視確認 |

### フェーズ4: テスト
| # | タスク | 状態 | 対象ファイル | テスト観点 |
|---|---|---|---|---|
| 4.1 | vitest 基盤スキャフォールド | ⬜ | `package.json` / `vitest.config.ts` | vitest devDep + `"test":"vitest run"` + `@/*` 解決。4.2 の前提 |
| 4.2 | `isToiletIndexable` 単体テスト | ⬜ | `src/lib/toiletSeo.test.ts`(新規) | §5.2 真理値表 9 ケース全網羅（T9 空白名=trim/btrim 差分）+ R3 の 2 分割（reviewed+inferred+unnamed=true / reviewed+not_a_toilet=5=false）。**期待値は 1.2 の採用 predicate 確定後に確定**（Step8-P1-4）。完了条件 = 4.4 で全ケース green |
| 4.3 | SQL 述語との同値検証 | ⬜ | 計測メモ + テストヘッダコメント | 007 apply 後に SQL Editor で §5.2 同表を再現。`toilet_indexable_count()` == 実測 n_indexable、`count(ids_page)`==count、列形確認。**`explain (analyze)` は index 使用だけでなく `toilet_ids_indexable_page(0,1000)` と中間 offset の実行時間も見る。悪ければ 2.1 を union 分割（review>0 経路 / named-osm 経路）に変える fallback を検討**（Step8-P1-3） |
| 4.4 | 検証コマンド実行 | ⬜ | （結果を 5.5 に供給） | `npm run test`（4.2 が green）→ `npm run lint` → `npm run build` を実行し pass/fail を記録。1 つでも失敗なら実装に戻る |

### フェーズ5: レビュー・完了
| # | タスク | 状態 | 備考 |
|---|---|---|---|
| 5.1 | 適用順序の実行（007 apply → 疎通 → build → deploy → smoke） | ⬜ | **逆順禁止**。手順: ①007 を prod に apply →②`select toilet_indexable_count();` が実測 N に一致するか疎通確認 →③`npm run build`（build 時 count が期待 N>0 か。0 なら deploy 中止）→④deploy →⑤`/robots.txt` と `/sitemap/1.xml` を smoke check（チャンク列挙・トイレ URL 出力）。007 未適用で deploy すると未定義 RPC → 0 fallback → sitemap 1 チャンク固定（退行、自動回復しない）（Step8-P1-2） |
| 5.2 | AC2 予算記録（1.2 成果物を転記して完了） | ⬜ | 1.2 の成果物（実測 N / chunk_count / D=1,2,4 Writes / 採用判定）を本ファイル/README に転記。**§4.4 全項目を明記**: `static_rows(20)` + `area_rows(|areaSlugs|×4)` + `toilet_rows(N×4)`、固定 ISR 分（sitemap `chunk_count×~30/月`、area `area_pages×~4/月`）、閾値 11,000 根拠、R4 注記 |
| 5.3 | セルフレビュー | ⬜ | canonical predicate の TS/SQL 一致、scope 逸脱なし、公開表記ポリシー |
| 5.4 | /codex:review（差分） | ⬜ | 差分 >300LOC なら必須 |
| 5.5 | PR 作成 | ⬜ | 本文に `Closes #1`。lint/build/test 結果。削除なしなので feature ブランチ |
| 5.6 | マージ + 再デプロイ（チャンク数確定） | ⬜ | R4: 大規模シード後はチャンク数再確定のため再デプロイ |

---

## テスト進捗（§5.2 真理値表 = 回帰の最小セット）

| # | source | name | review | not_a_toilet | 期待 | 分類 | 状態 |
|---|---|---|---|---|---|---|---|
| T1 | inferred | null | 3 | 0 | ✅true | 回帰(AC4保護) | ⬜ |
| T2 | osm | "X" | 2 | 5 | ❌false | 異常(除外) | ⬜ |
| T3 | osm | "博多駅前" | 0 | 0 | ✅true | 正常(新シグナル) | ⬜ |
| T4 | osm | "   " | 0 | 0 | ❌false | 境界(空白名) | ⬜ |
| T5 | osm | null | 0 | 0 | ❌false | 正常(無名落とす) | ⬜ |
| T6 | user | null | 0 | 0 | ❌false | 正常(対象外) | ⬜ |
| T7 | inferred | "○○モール" | 0 | 0 | ❌false | 正常(inferred除外) | ⬜ |
| T8 | osm | "X" | 0 | 4 | ✅true | 境界(not_a_toilet=4<5 直前) | ⬜ |
| T9 | osm | "\t" | 0 | 0 | ❌false | 境界(空白名 trim/btrim 差分) | ⬜ |

| 分類 | 総数 | Pass | Fail | 未実施 |
|---|---|---|---|---|
| 正常系 | 4 | 0 | 0 | 4 |
| 異常系 | 1 | 0 | 0 | 1 |
| 境界値 | 3 | 0 | 0 | 3 |
| 回帰 | 1 | 0 | 0 | 1 |

---

## 作業ログ

### 2026-06-14
- **実施**: /dev-init 1 を Step 0→8 まで順序実行。Step 5 Codex 設計書レビュー（P0×1/P1×2/P2×2 全採用）を設計書 §2-§9 に反映。Step 6 で並列サブエージェント 2 本（DB / App+test）でタスク分解 → 本ファイル生成。Step 7 Codex タスク分解レビュー（P0 なし/P1×3/P2×3 全採用）反映: フェーズ0新設、1.2 gate 化、4.4 追加、5.2 強化、T8 追加。Step 8 Codex 実装方針レビュー（P0 なし/P1×4 全採用）反映: NAMED 正規化を `~ '[^[:space:]]'` に（trim/btrim 差分）+T9、5.1 を疎通→build→deploy→smoke に具体化、2.3 index コメント+4.3 explain 実時間、3.1 を「1.2 完了まで deploy/merge 不可」。
- **進捗サマリ**: 設計確定・タスク分解確定（Step7/8 反映済）・テストパターン生成（Step9, TESTS-1.md）。/dev-init 全 Step（0→10）完了。実装タスク 0/20。
- **ブロッカー**: なし（実測 1.1 は prod paused 可能性のみ）

---

## 作業再開ガイド

- **最終作業タスク**: Step 9（テストパターン生成 → `docs/progress/TESTS-1.md`）完了 = /dev-init 全 Step 完了
- **中断理由**: /dev-init 完了。実装は /dev-resume で着手
- **次のアクション**: `/dev-resume docs/progress/PROGRESS-1.md` で再開。最初に着手可能なのは 0.1（ブランチ）→ 3.1（`isToiletIndexable`、base predicate、1.2 完了まで deploy/merge 不可）と 4.1（vitest 基盤）。DB 系（2.x）は 007 RPC 名確定後、実測 1.1 は prod resume 後

### 再開コマンド
```bash
git checkout -b feature/1   # 未作成
# 実装は 3.1 / 4.1 から（migration 007 RPC 名確定後に 3.2/3.3/3.5）
```

---

## メモ・課題

### 未解決課題
| # | 課題 | 優先度 | メモ |
|---|---|---|---|
| 1 | prod Supabase が free tier で paused → 実測 1.1 がブロックされ得る | 中 | 計測前に疎通確認、paused なら resume |
| 2 | Vercel「デプロイが on-demand ISR を無効化するか」(D 係数) 要公式確認 | 中 | 予算は D=1/2/4 幅で記録、Vercel Usage で実測。断言しない |
| 3 | vitest 未導入・`test`/`check` script 不在 | 中 | 4.1 で test 基盤追加。`check` の要否はメイン判断 |
| 4 | migration 007 適用とコード deploy の順序ハザード | 高 | 5.1：007 apply → 疎通 → build → deploy → smoke。逆順で sitemap 1 チャンク固定（退行・自動回復しない） |
| 5 | TS `trim()` と SQL `btrim()` 非同値（タブ/改行/全角） | 中 | SQL は `name ~ '[^[:space:]]'` に統一（§5.1）。全角スペース U+3000 は T9/SQL 実値で確認 |
| 6 | Next 16 `generateSitemaps` の docs 未確認（node_modules 未 install） | 低 | `npm install` 後に `node_modules/next/dist/docs/` で sitemap/ISR 仕様を再確認（AGENTS.md 指示） |

### 決定事項
| 日付 | 決定 | 理由 |
|---|---|---|
| 2026-06-14 | signal = named OSM + review維持、inferred 除外 | 実トイレ named=情報量多くthin回避。inferred は実物非特定UX + isToiletUnconfirmed と矛盾 |
| 2026-06-14 | `not_a_toilet<5` を TS 純関数にも含める | robots と sitemap RPC の真理値表を完全一致（R1 防止）。page の notFound と二重ガードだが無害 |
| 2026-06-14 | 既存 `getToiletCount`/`getToiletIdsPage` は温存（差し替えず新関数追加） | dead code だが新ファイル方針・回帰回避。整理は別 PR |
