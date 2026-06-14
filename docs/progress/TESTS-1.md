# テストパターン — Issue #1 未レビュートイレの段階的 indexable 化

> `/dev-init 1` Step 9 生成。正常 / 異常 / 境界 / 回帰の 4 分類。`isToiletIndexable`（TS 純関数）が主対象、加えて `sitemapChunkCount` / `getIndexable*` フォールバック / sitemap id>=1 / migration 007 RPC の挙動を網羅。実装は 4.2（vitest 単体）と 4.3（SQL 同値）でカバー。
> canonical predicate は設計書 §5.1、真理値表は §5.2。

## 1. `isToiletIndexable(t)` 単体（vitest, task 4.2）

`Toilet` ファクトリで全カラムを埋め、対象フィールドだけ変える。期待値は §5.2 と一致。

### 正常系
| ID | source | name | review | not_a_toilet | 期待 | 意図 |
|---|---|---|---|---|---|---|
| N1 | osm | "博多駅前公衆トイレ" | 0 | 0 | true | 新シグナル（named OSM）が index 化 = AC1 |
| N2 | osm | "公園トイレ" | 5 | 0 | true | named + reviewed 両成立 |
| N3 | inferred | null | 3 | 0 | true | reviewed は source 不問で index = AC4 保護 |

### 異常系
| ID | source | name | review | not_a_toilet | 期待 | 意図 |
|---|---|---|---|---|---|---|
| E1 | osm | "X" | 2 | 5 | false | not_a_toilet>=5 は reviewed でも除外（Step5-P0） |
| E2 | inferred | "○○モール" | 0 | 0 | false | inferred 未レビューは除外（実物非特定） |
| E3 | user | null | 0 | 0 | false | user 投稿・無名は対象外 |
| E4 | osm | null | 0 | 0 | false | 無名 OSM は thin、落とす |

### 境界値
| ID | source | name | review | not_a_toilet | 期待 | 意図 |
|---|---|---|---|---|---|---|
| B1 | osm | "   "(半角空白) | 0 | 0 | false | 空白のみ名は非 named |
| B2 | osm | "\t"(タブ) | 0 | 0 | false | JS trim/SQL btrim 差分の固定（Step8-P1） |
| B3 | osm | "　"(全角 U+3000) | 0 | 0 | false | JS trim は除去。SQL `[:space:]` が拾うか §3-SQL で実値確認 |
| B4 | osm | "X" | 0 | 4 | true | not_a_toilet=4（<5 直前）は通す |
| B5 | osm | "X" | 0 | 5 | false | not_a_toilet=5（閾値）は落とす |
| B6 | osm | "X" | 1 | 0 | true | review=1（>0 直後）で reviewed 経路成立 |

### 回帰（AC4：既存公開対象が落ちない）
| ID | source | name | review | not_a_toilet | 期待 | 意図 |
|---|---|---|---|---|---|---|
| R1 | inferred | null | 3 | 0 | true | 旧 `review_count>0` 対象が維持される（最重要退行） |
| R2 | osm | "駅トイレ" | 10 | 0 | true | reviewed+named、従来 indexable のまま |
| R3 | inferred | "モール" | 4 | 4 | true | reviewed（境界 not_a_toilet=4）も維持 |

## 2. `sitemapChunkCount()` 境界（task 3.4 / 4.x）

`getIndexableToiletCount()` をモックして検証。式 = `1 + ceil(count / 11000)`。

| ID | indexableCount | 期待 chunkCount | 意図 |
|---|---|---|---|
| C1 | 0 | 1 | 空でもチャンク0（静的+area）は存在（§6.5 境界） |
| C2 | 1 | 2 | 1 件でもトイレチャンク1 が増える |
| C3 | 11000 | 2 | ちょうど 1 チャンク（`ceil(11000/11000)=1`） |
| C4 | 11001 | 3 | 1 件超で 2 チャンクに分割 |
| C5 | 22000 | 3 | 2 チャンク満杯 |

## 3. `getIndexable*` フォールバック（task 3.2 / 3.3、異常系）

| ID | 条件 | 期待 | 意図 |
|---|---|---|---|
| F1 | `toilet_indexable_count` RPC エラー / env 欠落 | `getIndexableToiletCount()` → 0 → chunkCount=1 | 障害でも build/ページが落ちない（既存 0 fallback 規約） |
| F2 | `toilet_ids_indexable_page` RPC エラー | `getIndexableToiletIdsPage()` → []（部分 sitemap） | 取れた分だけ返す |
| F3 | 1001 件要求 | 1000+1 の 2 バッチ内部ページング | PostgREST 1000 行上限の踏襲（既存 `getToiletIdsPage` と同形） |
| F4 | ⚠️ build 時 count=0（007 未適用） | chunkCount=1 で build 成功・自動回復しない | **5.1 の deploy ゲートで検出する運用テスト**（期待 N>0 なら deploy 中止） |

## 4. sitemap id>=1 出力（task 3.5、正常/回帰）

| ID | 条件 | 期待 | 意図 |
|---|---|---|---|
| S1 | id=1、indexable 行あり | 各トイレ × 4 ロケールの URL（hreflang 省略） | チャンク復活の基本 |
| S2 | id=0 | 静的 + 全 area（hreflang 付き）。トイレ非掲載 | チャンク0 無変更の回帰 |
| S3 | `getIndexableToiletIdsPage` が空 | id>=1 は空配列 | 障害時に sitemap が壊れない |
| S4 | robots.txt | `sitemapChunkCount()` ぶんの `/sitemap/N.xml` を列挙 | robots 自動追従（共有関数） |

## 5. migration 007 RPC 同値（task 4.3、SQL 側）

prod/ローカルで §5.2 真理値表（N1–R3 と同条件の擬似行 or 既知 id）を SQL で再現し、TS と真偽一致を確認。

| ID | 検証 | 期待 |
|---|---|---|
| SQL1 | `toilet_indexable_count()` == 実測 n_indexable（task 1.1） | 一致 |
| SQL2 | `count(toilet_ids_indexable_page(0, 大))` == `toilet_indexable_count()` | 一致（ページャ健全） |
| SQL3 | `toilet_ids_indexable_page(0,5)` の列 | `(id uuid, created_at timestamptz)` |
| SQL4 | §5.2 各行を WHERE に通した真偽 | TS の N1–R3 と一致（特に R1/E1 = AC4 両側） |
| SQL5 | `explain(analyze)` 実行時間（0 offset / 中間 offset） | 許容内。悪ければ union 分割検討（Step8-P1-3） |

## カバレッジ対応（受入条件）
- **AC1**: N1 / N2（named OSM が index）/ SQL1
- **AC2**: task 5.2 の記録（§4.4）。テストではなくドキュメント証跡
- **AC3**: C1–C5（chunk 閾値 11000 の挙動）
- **AC4**: R1 / R2 / R3 / E1（落とす側）/ SQL4（TS-SQL 同値）= 退行防止の両輪
