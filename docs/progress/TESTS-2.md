# テストパターン — Issue #2 ユーザー投稿によるトイレ追加申請フロー

> `/dev-init 2` Step 9 生成。正常 / 異常 / 境界 / 回帰の 4 分類。主対象は ①`rateLimit` 拡張（座標キー）②`submit_toilet` RPC（dedup/confirm/閾値昇格/insert-only）③API バリデーション/エラー契約 ④pending 公開 RPC の列漏洩 ⑤`toiletSeo` の source=user パリティ。
> 設計詳細は PROGRESS-2.md §タスク一覧 + Notion 設計書 §5/§8。閾値（confirm_count・ST_DWithin 半径・バケット粒度）は task 1.3 で確定後にテスト値を確定する（下表は暫定: 閾値=3件 / 半径=30m / 5分窓）。

## 1. `rateLimit` 拡張 — `makeCoordKey` + IP rate limit（vitest, task 3.1）

### 正常系
| ID | 入力 | 期待 | 意図 |
|---|---|---|---|
| N1 | 近接2座標(同バケット) → `makeCoordKey` | 同一キー | バケット丸めで同地点が同キー |
| N2 | 初回 `checkAndRecord(ip, coordKey)` | `{ok:true}` | 初回は通す |

### 異常系
| ID | 入力 | 期待 | 意図 |
|---|---|---|---|
| E1 | 同 IP×同 coordKey を窓内に再呼び出し | `{ok:false, retryAfterSec>0}` | IP rate limit が効く |
| E2 | `lat/lng` が NaN/undefined | キー生成で弾く or 呼び出し側で 400 | 不正座標の防御 |

### 境界値
| ID | 入力 | 期待 | 意図 |
|---|---|---|---|
| B1 | バケット境界ちょうど跨ぐ2座標 | 別キー（=throttle は別扱い）だが dedup は実距離 ST_DWithin で判定 | 境界跨ぎ回避を dedup 側で吸収（Step8 #4 整合） |
| B2 | 窓ちょうど経過(=WINDOW_MS 直後) | `{ok:true}` | 窓満了で解放 |

## 2. `submit_toilet` plpgsql RPC（SQL/結合, task 3.2・3.3）

暫定閾値: confirm_count>=3 で昇格 / ST_DWithin=30m / 同地点 5分スロットル。

### 正常系
| ID | シナリオ | 期待 | 意図 |
|---|---|---|---|
| N3 | 新規地点に初回申請 | `toilet_submissions` に status=pending, confirm_count=1 / 戻り値=pending | 新規 pending 作成 |
| N4 | 既存 pending(別IP) に近接申請 ×2 で計3 | confirm_count=3 → status=approved, `toilets` に source=user 1行 insert / 戻り値=promoted | ハイブリッド自動承認 |
| N5 | 昇格後の `toilets` 行 | `source='user'`, location 一致, promoted_toilet_id 紐付 | insert-only 昇格の整合 |

### 異常系
| ID | シナリオ | 期待 | 意図 |
|---|---|---|---|
| E3 | 既存 `toilets`(osm) と 30m 以内に申請 | 戻り値=dup（pending 作らず既存へ誘導） | 既存重複の抑止 |
| E4 | 同一 IP が同一 submission を2回 confirm | `UNIQUE(submission_id, ip_hash)` で2件目拒否、confirm_count 増えない | distinct-ip 水増し除外（Codex #3） |
| E5 | 同地点に 5分以内の連投 | スロットルで拒否（DB側 created_at 判定） | フラッディング遮断（覇王案） |
| E6 | 同座標・同時刻の並行2申請(concurrent) | advisory lock で直列化、double-promotion せず（toilets 1行のみ） | 競合二重昇格防止（Codex #2） |
| E7 | `not_a_toilet_count>=5` 座標近傍への申請 | 抑止/自動却下 | 既存自己修正との連動 |

### 境界値
| ID | シナリオ | 期待 | 意図 |
|---|---|---|---|
| B3 | confirm_count=2（閾値直前） | pending のまま（未昇格） | 閾値未満は手動領域 |
| B4 | confirm_count=3（閾値ちょうど） | 昇格 | 閾値到達で自動承認 |
| B5 | ST_DWithin=30m ちょうど | dup 判定（含む/含まないを実装と一致させる） | 半径境界の固定 |
| B6 | スロットル窓=5分ちょうど経過後 | 受付 | 窓満了で解放 |

### 回帰
| ID | シナリオ | 期待 | 意図 |
|---|---|---|---|
| R1 | 既存 `toilets`(osm) 行 | 申請フローを通しても UPDATE/DELETE されない | OSM ピン破壊しない（AC4・insert-only） |
| R2 | `submission_confirmations` への UPDATE/DELETE | RLS/trigger で拒否 | ledger 追記専用の不変条件（task 2.2） |
| R3 | 既存 `toilets_in_bbox` RPC | 昇格 user トイレも返る、osm/inferred 挙動不変 | 既存マップ表示の非退行 |

## 3. API `/api/submissions`（route, task 3.2）

### 正常系
| ID | 入力 | 期待 | 意図 |
|---|---|---|---|
| N6 | 正常 body(lat/lng/access_level + 任意) | 200 pending or 201 promoted（RPC 結果に対応） | 正常受付 |

### 異常系
| ID | 入力 | 期待 | 意図 |
|---|---|---|---|
| E8 | lat/lng 欠落 | 400 | 必須検証 |
| E9 | access_level が enum 外 | 400（Set 検証、既存 reviews パターン） | enum 検証 |
| E10 | dup（RPC=dup） | 409 | 重複の HTTP 契約 |
| E11 | IP rate limit 超過 | 429 + retry-after | スパムで止まらない（AC5） |
| E12 | 不正 JSON | 400 invalid json | 既存パターン踏襲 |

### 境界値
| ID | 入力 | 期待 | 意図 |
|---|---|---|---|
| B7 | comment 500字ちょうど/501字 | 500=通す / 501=切詰 or 400 | 既存 reviews の上限慣例に合わせる |
| B8 | name 空文字/空白のみ | name=null 扱い（任意フィールド） | 無名申請の許容 |

## 4. pending 公開 RPC `pending_submissions_in_bbox`（SQL, task 3.2）

### 異常系（個人データ漏洩防止 — Codex #8）
| ID | 検証 | 期待 | 意図 |
|---|---|---|---|
| E13 | RPC 戻り列 | `id/lat/lng/name/status/confirm_count/created_at` のみ。**ip_hash を含まない** | 個人データ非返却 |
| E14 | anon ロールでテーブル直 select | 拒否（RLS） | 直接読取を開けない |

### 正常系
| ID | 検証 | 期待 | 意図 |
|---|---|---|---|
| N7 | bbox 内 pending | pending のみ返る（approved は toilets 側） | 薄色ピン用データ供給 |

## 5. `toiletSeo` SQL-TS パリティ（vitest + SQL, task 3.4）

### 正常系 / 回帰
| ID | source | name | review | 期待 indexable | 意図 |
|---|---|---|---|---|---|
| N8 | user | "○○ビルトイレ" | 1 | true | user 投稿もレビュー1件で昇格（既存ルール踏襲・007 述語拡張） |
| E15 | user | null | 0 | false | user 未レビューは除外（既存 inferred と同じ品質ゲート） |
| R4 | osm | "駅トイレ" | 0 | true | named OSM の従来挙動が不変（Issue #1 退行防止） |
| SQL1 | §007 述語 SQL と `toiletSeo.ts` TS 述語 | N8/E15/R4 で真偽一致 | SQL-TS パリティ（Codex #) |

## カバレッジ対応（受入条件）
- **AC1（申請UI）**: UI は手動/Playwright 確認（task 4.x）。API 経路は N6
- **AC2（Supabase 蓄積）**: N3 / N4
- **AC3（モデレーション体制）**: N4（自動承認）/ B3-B4（閾値）/ ドキュメント証跡（CLAUDE.md task 4.4）
- **AC4（OSM ピン破壊しない）**: R1 / R2 / E3 / R3
- **AC5（スパムで止まらない）**: E1 / E5 / E6 / E11
- **AC6（CLAUDE.md 反映）**: ドキュメント証跡（task 4.4）

## テスト件数サマリ
- 正常系: 8（N1-N8）
- 異常系: 15（E1-E15）
- 境界値: 8（B1-B8）
- 回帰: 4（R1-R4）+ SQL パリティ（SQL1）
- 合計: 35 +α
