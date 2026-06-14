# #2: [Phase 2] ユーザー投稿によるトイレ追加申請フロー

> このファイルは `/dev-init 2` が生成した進捗管理表。`/dev-resume` はここを読んで現在位置を特定する。文脈は会話でなくこのファイルに持たせる。Notion=安定した概要、このファイル=生きた実行状態（最重要・Git管理）。

## 基本情報

| 項目 | 内容 |
|---|---|
| GitHub Issue | #2 [Phase 2] ユーザー投稿によるトイレ追加申請フロー |
| Notion 設計書 | https://app.notion.com/p/37f1ef8488d581b0afbdcac99672cdfc |
| ブランチ | feature/2 |
| 開始日 / 目標完了日 | 2026-06-14 / 未定 |
| 最終更新 | 2026-06-14 (dev-init Step 6 完了時点) |

---

## 要件サマリー

### 背景・目的
OSM `amenity=toilets` をシードしただけで、ユーザーが「ここトイレあります」を追加申請する導線がない。MVP では意図的に外したが、公開後「自分が知ってる近所のトイレが出てない」フィードバックが想定される。Phase 2 としてユーザー投稿フローを設計・実装する。競合「トイレ情報共有マップくん」はユーザー投稿型で100万DL。

### 確定した設計判断（人間の意思決定 / 2026-06-14）
| 論点 | 決定 |
|---|---|
| 認証 | **匿名可**（Auth 必須化しない。Phase 1 レビューと同思想・3タップ原則・摩擦最小） |
| 公開方式 | **ハイブリッド**（pending + 信頼スコアで自動承認）。多層防御で維持（手動のみには退かない） |
| OSM 還元 | **スコープ外 + source 分離のみ**（ODbL share-alike 防御。匿名と upstream は相性悪い。Phase 3+） |
| 入力UI | **中央ピン方式**（地図中央固定ピン→地図を動かして位置合わせ→確定） |
| 写真投稿 | **なし（維持）** |
| pending 表示 | **薄色ピンで表示**（他ユーザーの追認 confirm を促す。承認で実線ピンに昇格） |
| SEO | **既存ルール踏襲**（user 投稿もレビュー1件以上で indexable に昇格。007 述語拡張） |

### 受入条件
- [ ] 1. ユーザーが地図上から新規トイレを申請できる UI がある（中央ピン方式 + 申請フォーム）
- [ ] 2. 申請データが Supabase に蓄積される（`toilet_submissions`, status=pending）
- [ ] 3. モデレーション体制（人手 or 自動）が決まっており文書化されている（§モデレーション運用 + CLAUDE.md）
- [ ] 4. 既存の OSM ピンを破壊しない（`source` で区別 + 昇格 insert-only + CHECK 制約）
- [ ] 5. スパム流入時にサービスが止まらない rate-limit 設計（多層防御）
- [ ] 6. CLAUDE.md の Phase 表に「Phase 2 実装済」として反映

### スコープ
- **対象**: 中央ピン UI + 申請フォーム / `toilet_submissions` テーブル / ハイブリッド承認（ST_DWithin 近接で confirm_count→閾値で自動承認、それ以外手動）/ source=user で DB 分離 / ST_DWithin dedup / 座標ベース rate-limit + 5分スロットル / pending 薄色ピン / 4言語 i18n / CLAUDE.md 更新
- **対象外**: 写真投稿 / 削除申請(Phase3+) / 編集申請(Phase3+) / AdSense / Auth必須化 / OSM upstream / 貢献者ポイント

---

## コードベース調査結果（dev-init Step 3）

### 直接修正対象ファイル
| パス | 役割 | 修正内容 |
|---|---|---|
| `supabase/migrations/008_toilet_submissions.sql` (新) | 申請テーブル | テーブル + confirmation ledger + RLS/GRANT + index + `pending_submissions_in_bbox` RPC + 自動承認/dedup ロジック |
| `supabase/migrations/009_source_constraint_seo.sql` (新) | 不変条件 + SEO | `toilets.source` CHECK 制約追加、`007` の indexable 述語を `source='user'` も含むよう拡張 |
| `src/app/api/submissions/route.ts` (新) | 申請受付 API | 匿名・型検証・座標 rate limit・5分スロットル・ST_DWithin dedup・confirm ledger・WKT insert（secret key） |
| `src/components/Map/AddToiletFlow.tsx` (新) | 中央ピン UI | 中央固定ピン + 申請フォーム（ReviewForm パターン） |
| `src/store/mapStore.ts` | 状態管理 | `addMode` / `addDraft`(中央ピン座標) state + pending submissions 保持 |
| `src/types/toilet.ts` | 型定義 | `ToiletSubmission` 型追加（`source='user'` は L17 で定義済み） |
| `src/components/Map/pinIcon.ts` | ピン描画 | pending 用の薄色（半透明）ピンスタイル |
| `src/components/Map/ToiletMap.tsx` | 地図本体 | 「トイレを追加」エントリ + 中央ピンオーバーレイ + pending 薄色ピン描画 |
| `src/components/Map/PinSheet.tsx` | 詳細シート | 「トイレを追加」導線（既存「ない」報告リンク付近） |
| `messages/{ja,en,ko,zh}.json` | i18n | `addToilet` namespace 4ファイル |
| `CLAUDE.md` | ドキュメント | Phase 表に Phase 2 実装済反映 + モデレーション体制文書化 |

### 参照・影響範囲ファイル
| パス | 役割 | 影響 |
|---|---|---|
| `src/lib/rateLimit.ts` | rate limit | 座標バケットキー関数 + 5分スロットル追加（既存 `checkAndRecord` 流用） |
| `src/lib/supabase/server.ts` | Supabase クライアント | `getServerSupabaseSecret()` をそのまま使用（修正なし） |
| `src/app/api/toilets/route.ts` | bbox フェッチ | pending 表示用に `pending_submissions_in_bbox` を呼ぶ or 別エンドポイント |
| `supabase/migrations/003_not_a_toilet_reports.sql` | 自己修正 | `not_a_toilet_count>=5` 除外を昇格後トイレにも適用（参照） |
| `supabase/migrations/007_seo_indexable.sql` | SEO 述語 | `source='osm'` 限定を拡張（009 で対応） |
| `src/lib/toilets.ts` | SSR データ取得 | 昇格 user トイレが既存 RPC 経由で出る前提（影響確認） |

### 既存実装の参考箇所
| 参考ファイル | 行 | 参考内容 |
|---|---|---|
| `src/components/ReviewForm.tsx` | 9, 17-58 | Mode 分岐、state 管理、バリデーション、fetch、送信後 UI、`useTranslations` 参照 |
| `src/app/api/reviews/route.ts` | 7, 19-77 | 型安全ボディ検証、Set による enum 検証、`checkAndRecord` rate limit、`getServerSupabaseSecret` insert、エラーレスポンス形式 |
| `src/lib/rateLimit.ts` | 24-34 | `checkAndRecord(ipHash, key)`、キャッシュキー `ipHash:key`、`WINDOW_MS`、`retryAfterSec` |
| `supabase/migrations/001_init.sql` | 7-13, 15-31, 102-122 | enum 定義(do block)、テーブル+GiST index、RLS/GRANT パターン |
| `supabase/migrations/003_not_a_toilet_reports.sql` | 24-25, 70-74 | DROP→CREATE OR REPLACE で戻り値変更、ST 系の使い方、除外ロジック |
| `src/components/Map/ToiletMap.tsx` | 64-90, 140-154 | `debounce`, `BoundsWatcher`(moveend/zoomend + center 取得), `useRef` debounce refetch |
| `src/components/Map/pinIcon.ts` | 6-55 | `makePinIcon` SVG 生成・`L.divIcon`・className でスタイル切替 |
| `src/store/mapStore.ts` | 22-48, 101-140 | zustand state 構成、localStorage 永続化パターン |

---

## 詳細タスク一覧

ステータス凡例: ⬜未着手 🔄進行中 ✅完了 ⏸️保留 ❌中止

### フェーズ1: 準備・設計確認
| # | タスク | 状態 | 対象ファイル | 実装詳細 |
|---|---|---|---|---|
| 1.1 | ブランチ作成 | ✅ | — | `git checkout -b feature/2`（2026-06-14 完了） |
| 1.2 | 設計制約の再確認 | ✅ | Notion §8 | 多層防御4層（IP rate limit + 5分スロットル + distinct-ip confirm ledger + 自己修正 not_a_toilet）・insert-only 昇格・RLS/RPC で個人データ非返却を再確認済み |
| 1.3 | **閾値・粒度の数値確定** | ✅ | このファイルに記録 | **確定値（2026-06-14, 人間承認）**: 自動承認 `confirm_count >= 3` / dedup `ST_DWithin = 30m`（既存 toilets・既存 pending 共通）/ 座標バケット `geohash precision 7`（≈153m 格子, in-memory rate limit キー用）/ 同地点スロットル `5分窓`（DB 側 created_at 判定）。AC3/AC5 の根拠数値。テスト値も同値で確定（TESTS-2.md 暫定欄を昇格） |

### フェーズ2: 実装（依存順 / Step8 再改訂: 昇格を plpgsql RPC に集約・DB側スロットル・RPC列限定・docsをPhase4へ）
| # | タスク | 状態 | 対象ファイル | 実装詳細 |
|---|---|---|---|---|
| 2.1 | 申請テーブル migration | ✅ | `supabase/migrations/008_toilet_submissions.sql` | `toilet_submissions` + 運用フィールド、`submission_confirmations` ledger(`UNIQUE(submission_id, ip_hash)`)、GiST + `(status,created_at)` index、RLS、GRANT、`promoted_toilet_id ... on delete set null` を実装 |
| 2.2 | **insert-only guard** | ✅ | 同上 008 | `forbid_ledger_mutation()` trigger で ledger の UPDATE/DELETE を禁止(security definer 経路でも効く)。toilets 昇格は RPC で INSERT のみ(seed の osm upsert があるため全 UPDATE 禁止 trigger は張らない方針を明記) |
| 2.3 | 公開 RPC（pending bbox）+ dedup ヘルパ | ✅ | 同上 008 | `pending_submissions_in_bbox` は明示列のみ返却(ip_hash 非返却)。`nearby_toilet(lat,lng,radius)` dedup ヘルパ実装 |
| 2.4 | **`submit_toilet` plpgsql RPC（атом昇格）** | ✅ | 同上 008 | 単一トランザクション。①advisory lock(round3桁バケット)→②5分スロットル(地点グローバル/全status)→③既存 toilets 30m dup→④既存 pending 30m confirm(distinct ip)/新規 pending→⑤confirm_count>=3 で insert-only 昇格。戻り値 throttled/dup/pending/promoted |
| 2.5 | source CHECK + SEO 述語（SQL+TS パリティ） | ✅ | `supabase/migrations/009_source_constraint_seo.sql` | `toilets.source` CHECK 追加。**SEO 述語は変更不要**と判定: 007 の `review_count>0` ブランチが source 非依存で「user もレビュー1件で昇格」を既に満たす。`toiletSeo.ts` も無変更で SQL-TS パリティ成立(redundant な OR を足さない) |
| 2.6 | 型追加 | ✅ | `src/types/toilet.ts` | `ToiletSubmission`(pending ピン表示=RPC 戻り値準拠の最小形) + `SubmissionInput`(POST ペイロード)に分割。is_outdoor は submission のみ保持(toilets に列なし) |
| 2.7 | rate limit 拡張（IP のみ） | ✅ | `src/lib/rateLimit.ts` | `makeCoordKey(lat,lng)`(round 3桁=DB の advisory lock バケットと整合) + NaN/Infinity で throw。5分スロットルは DB 側へ移管 |
| 2.8 | API route（thin） | ✅ | `src/app/api/submissions/route.ts`(新) | POST。手動 JSON parse + Set enum + 範囲チェック + IP rate limit + `submit_toilet` RPC + 結果→HTTP(200/201/409/429/500) |
| 2.9 | pending フェッチ API | ✅ | 同上 route.ts の GET | `GET /api/submissions?bbox=` で `pending_submissions_in_bbox`(publishable)。store 統合は ToiletMap 側 |
| 2.10 | **i18n（UI より前）** | ✅ | `messages/{ja,en,ko,zh}.json` | `addToilet` namespace 28キー 4言語。文字列挿入で既存整形を保持 |
| 2.11 | store 拡張 | ✅ | `src/store/mapStore.ts` | `addMode`/`addDraft`/`pendingSubmissions` + `confirmTarget`(追認)/`dataVersion`+`bumpData`(送信後再フェッチ) を追加 |
| 2.12 | 薄色ピン（inferred と別語彙） | ✅ | `src/components/Map/pinIcon.ts` | `makePendingPinIcon` 新設。indigo・点線(dotted)・「+」グリフ・confirm数バッジで inferred(破線+access色+星)と明確に区別 |
| 2.13 | 中央ピン overlay + 位置キャプチャ | ✅ | `AddModeWatcher.tsx`(新) + `AddToiletFlow.tsx`(新) | MapContainer 内 `AddModeWatcher` が moveend で中心を addDraft に同期。外側 overlay が CSS 中央十字ピン + 確定バー |
| 2.14 | 申請フォーム + 送信動作 | ✅ | AddToiletFlow.tsx | name/access/屋外/多目的/補足 → POST → 結果別 done メッセージ → 1.6s で閉じ。ReviewForm パターン |
| 2.15 | 地図統合 | ✅ | `ToiletMap.tsx` / `PendingMarkers.tsx`(新) | FAB「トイレを追加」→ addMode。`PendingMarkers` が pending 薄色ピン描画(タップで追認モーダル)。pending fetch + dataVersion 再フェッチ配線。※PinSheet 導線は FAB に集約し見送り(3タップ原則・UX 上の判断、決定事項参照) |

### フェーズ3: テスト（詳細は dev-init Step 9 で生成 → TESTS-2.md）
| # | タスク | 状態 | 対象ファイル | テスト観点 |
|---|---|---|---|---|
| 3.1 | rate limit 単体 | ✅ | `src/lib/rateLimit.test.ts`(新) | makeCoordKey(N1/E2/B1) + checkAndRecord(N2/E1/B2 + IP独立)。8 ケース pass |
| 3.2 | API バリデーション | ✅ | `src/app/api/submissions/route.test.ts`(新) | supabase mock。E12/E8/E9/範囲外→400、N6=200/promoted=201/dup=409/throttled=429/error=500。9 ケース pass |
| 3.3 | insert-only ガード | ⚠️SQL/手動 | (DB トランザクション依存) | vitest(node, DB なし)では実行不可。**SQL 検証として 008 の trigger/RPC で担保**(ledger UPDATE/DELETE→例外、昇格 INSERT-only、E6 advisory lock 直列化)。デプロイ後 smoke test で R1/R2/E6 を手動確認(4.5) |
| 3.4 | 既存テスト回帰 | ✅ | `src/lib/toiletSeo.test.ts`(追加) | source=user パリティ N8/E15/E15'/not_a_toilet 除外 を追加(既存 assertion 不変)。SQL-TS パリティを TS 側で固定 |

### フェーズ4: レビュー・完了
| # | タスク | 状態 | 備考 |
|---|---|---|---|
| 4.1 | セルフレビュー + `pnpm run lint && pnpm run build` | ✅ | lint clean / build 成功 / test 37/37。mise 経由 node |
| 4.2 | /codex:review（実装差分） | 🔄 | 差分 >300LOC 想定なら必須。特に 2.4 RPC のロック/冪等性を再検証 |
| 4.3 | reviewer サブエージェント監査 | ⬜ | 公開表記/ i18n 漏れ/セキュリティ/スコープ/RPC 列漏洩 |
| 4.4 | **CLAUDE.md 更新**（lint/build/test 後） | ⬜ | Phase 表に Phase 2 実装済 + モデレーション運用（承認/却下基準/insert-only）文書化。※テスト失敗時に "実装済" を残さないため Phase 4 に配置 |
| 4.5 | **デプロイ順序の遵守** | ⬜ | **008/009 migration 適用 → smoke test → コードデプロイ** の順（順序ミスで `toilet_submissions`/RPC 不在 → `/api/toilets` も 500 で地図全壊）。CLAUDE.md の「005/006 同様デプロイ前手動適用」方針に追記 |
| 4.6 | PR 作成 | ⬜ | 本文に `Closes #2`、自動生成マーク、build/test/check 結果 |
| 4.7 | マージ → Notion / 進捗表更新 | ⬜ | notion-sync |

---

## テスト進捗

| 分類 | vitest 化 | Pass | DB/手動(3.3) |
|---|---|---|---|
| rateLimit (3.1) | 8 | 8 | — |
| API route (3.2) | 9 | 9 | — |
| toiletSeo パリティ (3.4 追加分) | 4 | 4 | — |
| 既存 toiletSeo 回帰 | 16 | 16 | — |
| **vitest 合計** | **37** | **37** | — |
| submit_toilet RPC / insert-only (3.3) | — | — | SQL 検証 + デプロイ後 smoke(N3/N4/E3-E7/B3-B6/R1-R3) |

vitest は `pnpm test` で 37/37 pass。DB トランザクション依存(advisory lock・ST_DWithin・ledger trigger・閾値昇格)は node 環境では実行できないため、008 の SQL ロジックで担保し、デプロイ後 smoke test(4.5)で確認する。閾値は task 1.3 で確定済(confirm>=3 / 30m / 5分 / round3桁)。

---

## 作業ログ

### 2026-06-14 (dev-init)
- **実施**: dev-init Step 0-9 完了。Codex 認証確認 → Issue 解析 → 成果物選択(両方) → 並列コードベース調査(4本) → 人間の設計判断4件 → Notion 設計書作成 → Codex 設計レビュー(3サイクル) → 人間の追加判断3件 → 設計書 §8 反映 → 進捗表生成 → Codex タスク分解レビュー(採用5/却下1) → タスク改訂 → Codex 実装方針レビュー(採用8/却下1) → タスク再改訂 → テストパターン生成(TESTS-2.md, 35+α件)。
- **進捗サマリ**: dev-init 完了（設計+タスク分解+実装方針+テストパターン）。実装未着手。完了 0 / 総数 (準備3 + 実装15 + テスト4 + 完了7)
- **ブロッカー**: なし

### 2026-06-14 (dev-resume 実装)
- **実施**: `feature/2` 作成。task 1.3 閾値確定(人間承認: confirm>=3 / 30m / round3桁 / 5分) → フェーズ2 全実装(2.1-2.15) → フェーズ3 テスト(3.1/3.2/3.4 vitest化、3.3 は SQL/手動)。
  - DB: `008_toilet_submissions.sql`(テーブル+ledger+insert-only trigger+RLS/GRANT+pending RPC+nearby_toilet+submit_toilet アトミック RPC) / `009_source_constraint_seo.sql`(source CHECK、SEO 述語は変更不要と判定)
  - TS: types(ToiletSubmission/SubmissionInput) / rateLimit(makeCoordKey) / api/submissions(GET+POST) / mapStore 拡張 / pinIcon(makePendingPinIcon) / AddModeWatcher / PendingMarkers / AddToiletFlow / ToiletMap 統合 / i18n 4言語
  - 検証: `pnpm run lint` clean / `pnpm run build` 成功(`/api/submissions` 出力確認) / `pnpm test` 37/37 pass
  - lint 修正: refetch を useRef().current → useMemo 化(react-hooks/refs)、AddToiletFlow の reset effect 撤去 + 追認モーダルを子コンポーネント分離(setState-in-effect 回避)
- **進捗サマリ**: 完了 = 準備3 + 実装15 + テスト3(+3.3 はSQL検証) + 4.1。残: 4.2 Codex レビュー → 4.3 reviewer → 4.4 CLAUDE.md → 4.5 デプロイ → 4.6 PR → 4.7 Notion
- **ブロッカー**: なし

---

## 作業再開ガイド

- **最終作業タスク**: dev-init Step 9（テストパターン生成）完了 = **dev-init 全工程完了**。次は実装フェーズ（dev-resume）。
- **中断理由**: dev-init 完了、実装はユーザーの再開待ち
- **次のアクション**: `/dev-resume` で再開 → フェーズ1 task 1.1（ブランチ作成）から着手。実装順は フェーズ2 の 2.1（migration）から依存順に。

### 再開コマンド
```bash
git checkout -b feature/2   # 初回。2回目以降は git checkout feature/2
git pull
```

---

## メモ・課題

### 未解決課題
| # | 課題 | 優先度 | 期限 |
|---|---|---|---|
| 1 | ~~自動承認閾値の具体値~~ → **確定済 (2026-06-14)**: confirm_count>=3 / ST_DWithin=30m | — | ✅ |
| 2 | ~~座標バケット丸め粒度~~ → **確定済 (2026-06-14)**: geohash precision 7（≈153m） | — | ✅ |
| 3 | 残存 Sybil リスク（多 IP + 5分待機の単発偽承認）受容済み。Auth 導入後に強化 | 低 | Phase 3+ |
| 4 | rate limit の in-memory はサーバーレスで甘い。DB 方式(`ip_hash+created_at`)移行は将来 | 中 | 将来 |
| 5 | 本格的なモデレーション管理画面は将来タスク（初期は Supabase dashboard 手動） | 低 | 将来 |

### 決定事項
| 日付 | 決定 | 理由 |
|---|---|---|
| 2026-06-14 | 匿名投稿可 | Phase 1 レビューと同思想・3タップ原則・摩擦最小 |
| 2026-06-14 | ハイブリッド承認を多層防御で維持 | 手動のみは運用負荷。IP+5分スロットル+distinct ip confirm+自己修正の4層 |
| 2026-06-14 | 同一地点 5分スロットル追加（覇王案） | IP 制約に直交するフラッディング遮断の第2の壁 |
| 2026-06-14 | confirm_count は distinct ip_hash のみ加算 | bare counter は監査不能（Codex #3）。ledger + UNIQUE で水増し除外 |
| 2026-06-14 | OSM 還元はスコープ外 + source 分離のみ | ODbL share-alike 防御。匿名と upstream は相性悪い |
| 2026-06-14 | pending を薄色ピンで表示 | 他ユーザーの追認 confirm を促す |
| 2026-06-14 | 昇格は insert-only + CHECK 制約 | 既存 OSM ピン破壊防止を不変条件化（Codex #7） |
| 2026-06-14 | SEO は既存ルール踏襲（user もレビューで昇格） | 品質ゲート整合（Codex #9） |
| 2026-06-14 | Step7: API を3分割(2.7骨格/2.8 dedup/2.9 confirm+昇格) | Codex 指摘「2.6 密度過大」採用。レビュー容易化 |
| 2026-06-14 | Step7: insert-only guard を独立タスク化(2.2) | Codex 指摘「guard タスク欠如」採用。ledger 追記専用・昇格 INSERT のみを不変条件化 |
| 2026-06-14 | Step7: i18n(2.11) を UI(2.14-2.16) より前に | Codex 指摘「規約違反」採用。useTranslations 前提・4言語必須 |
| 2026-06-14 | Step7: 閾値/粒度確定タスク(1.3) を文書化前に追加 | Codex 指摘 AC3/AC5「数値未決定」採用 |
| 2026-06-14 | Step8: 昇格を `submit_toilet` plpgsql RPC(атом, advisory lock)に集約(2.4) | Codex「route 複数insert非атом」「concurrent double-promotion」採用。中途半端な状態/二重昇格を DB トランザクションで防止 |
| 2026-06-14 | Step8: 同一地点5分スロットルを DB側(RPC)へ、IP rate limit は in-memory 踏襲 | Codex「in-memory はサーバーレスで甘い」採用。地点スロットルは created_at で判定 |
| 2026-06-14 | Step8: zod 不採用、手動JSON parse+Set enum 踏襲 | 既存 reviews/route.ts に合わせる（周辺コード整合）。Codex 指摘を却下方向で確定 |
| 2026-06-14 | Step8: pending RPC は明示列のみ返却(ip_hash 非返却) | Codex「公開RPCで個人データ漏洩」採用 |
| 2026-06-14 | Step8: pending ピンは inferred と別の視覚語彙 | Codex「破線+半透明が衝突」採用。isPending で別形状 |
| 2026-06-14 | Step8: CLAUDE.md 更新を Phase4 へ、デプロイ順序を明文化 | Codex「docs早期確定」「migration順序ミスで地図全壊」採用 |
| 2026-06-14 | 実装: SEO 述語(009)は変更不要 | 007 の `review_count>0` ブランチが source 非依存で「user もレビュー1件で昇格」を既に満たす。redundant な `OR (source='user'...)` は二重述語で保守性を下げるため追加しない。009 は CHECK 制約のみ |
| 2026-06-14 | 実装: is_outdoor は submission のみ保持(toilets 非昇格) | toilets に is_outdoor 列がなく、追加はスキーマ拡張=スコープ膨張。モデレーション文脈として submission に記録し、昇格時は name/location/inferred_access/is_universal のみ写す |
| 2026-06-14 | 実装: 5分スロットルは地点グローバル(IP 直交) | 「IP に直交した第2の壁」の設計意図通り。confirm も 5分間隔を強制(正規の追認は時間を空けて起こる前提) |
| 2026-06-14 | 実装: 追加導線は FAB に集約、PinSheet 導線は見送り | FAB が全画面共通の主導線で AC1 充足。特定トイレ詳細に「別トイレ追加」は紛らわしく 3タップ原則に反する。Phase3+ で「ない」報告→近接追加の動線統合を再検討 |
| 2026-06-14 | 実装: 追認は access=open 既定送信 | submit_toilet の confirm 経路は p_access を読まない(新規 pending insert 時のみ使用)。追認ペイロードの access は無視されるため固定値で可 |
