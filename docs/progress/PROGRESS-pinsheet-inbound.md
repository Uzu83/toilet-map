# PinSheet 実用情報 & インバウンド使い方ガイド

> 自動生成(/deep-research のフォロー実装)。GitHub Issue なしの直接タスク。
> Codex 完全承認のみをゲートにマージまで自走するパイプラインの設計書 兼 進捗管理表。

## 基本情報

| 項目 | 内容 |
|---|---|
| GitHub Issue | なし(deep-research 提案からの直接実装) |
| 由来 | deep-research レポート P1「インバウンド使い方レイヤー」+ 実用情報(営業時間/24h) |
| ブランチ | `auto/feature-2026-06-20`(origin/main = e4273dd から分岐) |
| 開始日 | 2026-06-20 |
| 最終更新 | 2026-06-20 |
| 承認ゲート | Codex 完全同意のみ(各ゲート最大5往復、未収束で停止→翔士希判断) |

---

## 要件サマリー

### 背景・目的
deep-research レポートの示唆:
- **インバウンド需要が巨大**(訪日 2025 ≈ 4,268万人、LIXIL 調査で外国人の約47%が日本のトイレ操作ボタンを理解できない)。Loo map は ja/en/ko/zh の4言語資産を持つ数少ないプレイヤー。
- 競合(Flush 等)は **24h / 営業時間 / 設備属性** を主軸。Loo map は属性フィルタ(washlet/diaper/universal)・ルート案内は既に実装済みだが、**詳細シート(PinSheet)に「営業時間」「24時間」「日本のトイレの使い方」を出していない**。
- これらは **frontend/i18n のみ・DB マイグレーション不要・依存追加不要** で埋められる空白。今夜の自走に最適(本番マイグレーション無人適用の危険を回避)。

### 受入条件(自己定義 AC)
- [x] AC1: `opening_hours` が 24/7 系のトイレに「24時間」バッジが表示される
- [x] AC2: `opening_hours` を持つ「非24h・非推定」トイレに営業時間行が表示される(推定ピンは従来の警告内表示のまま=重複なし、24h はバッジのみ=重複なし)
- [x] AC3: PinSheet に「日本のトイレの使い方」ガイドが折り畳み(`<details>`)で表示。**非 ja ロケールは既定オープン / ja は既定クローズ**。4言語で表示
- [x] AC4: 既存機能(共有・お気に入り・評価・報告・ルート案内・推定警告)に回帰なし ※ build/型/lint/test + Codex 差分レビューで確認。**実機スモークは翔士希が朝に実施推奨**(main 自動デプロイ OFF ゆえマージしても本番未反映)
- [x] AC5: `pnpm lint` / `pnpm build` / `pnpm test` 全パス(vitest 49/49)。`is24h` のユニットテストあり(10ケース)
- [x] AC6: i18n 4ファイル(ja/en/ko/zh)整合(キー欠落なし)。公開表記ポリシー遵守(本名・事業者メアドを出さない)

### スコープ
- **対象**: `src/components/Map/PinSheet.tsx`、新規 `src/lib/openingHours.ts`(+テスト)、`messages/{ja,en,ko,zh}.json`
- **対象外(意図的に今夜やらない)**:
  - DB マイグレーション / seed 変更 / 新規依存追加
  - 「営業中(open now)」のリアルタイム判定(opening_hours のフル構文パースが必要 → タイムゾーン/祝日エッジが多い。`opening_hours` 依存は既に package.json に存在するが、クライアント表示に持ち込まず、リアルタイム判定自体を今夜はやらない)
  - FilterBar の変更(属性フィルタは既に実装済み = `mapStore.applyFilters`)
  - ルート案内の `?origin=userPos` 付与(後述、ドロップ判断)
  - 車椅子/オストメイト等の新属性(データ=migration が必要、Phase 2 で別途)

---

## コードベース調査結果

### 直接修正対象ファイル
| パス | 役割 | 修正内容 |
|---|---|---|
| `src/components/Map/PinSheet.tsx` | トイレ詳細ボトムシート("use client") | 24h バッジ・営業時間行・使い方ガイド `<details>` を追加 |
| `src/lib/openingHours.ts`(新規) | OSM `opening_hours` 文字列の純関数判定 | `is24h(raw)` を実装(保守的・依存なし) |
| `src/lib/openingHours.test.ts`(新規) | 上記のユニットテスト | vitest |
| `messages/ja.json` ほか en/ko/zh | i18n | `pinSheet.open24h` / `pinSheet.openingHoursLabel` を4言語追加 |

### 既存実装の参考箇所
| 参考 | 行 | 参考内容 |
|---|---|---|
| `PinSheet.tsx` | 47 | `mapsHref`(Google Maps directions、既存) |
| `PinSheet.tsx` | 123-156 | バッジ行(washlet/diaper/universal の色付きチップ)。24h バッジはこの並びに追加 |
| `PinSheet.tsx` | 158-167 | 推定ピンの警告(opening_hours はここで既に表示)。非推定は別途行で表示する |
| `PinSheet.tsx` | 169-178 | 星評価行。営業時間行はこの直後に置く |
| `messages/ja.json` | 28-32 | `onboarding.etiquette*`(4言語完備)。使い方ガイドはこれを再利用 |
| `messages/ja.json` | 52-73 | `pinSheet` namespace(新キー追加先) |
| `messages/ja.json` | 256 | `toiletPage.hoursLabel`="営業時間"(SEO ページは既に営業時間表示済み=PinSheet だけ欠落の裏付け) |
| `src/lib/rateLimit.test.ts` | — | vitest 純関数テストの書き方の手本 |

---

## 設計詳細(Codex レビュー対象)

### 要素1: 営業時間表示 + 24時間バッジ
- `src/lib/openingHours.ts` に **厳格な** `is24h(raw: string | null | undefined): boolean`:
  - 正規化(`trim().toLowerCase()`)後、**`"24/7"` 完全一致のときのみ** true。`24/7; PH off` や `24/7 open` 等の接尾辞・例外付きは **false**(→ 営業時間行で生文字列を見せ、祝日休業などの例外情報を隠さない)。
  - **WHY(コメントで明記)**: `opening_hours` 依存は既に package.json にある(seed/OSM パース用)が、クライアント表示のバッジ判定のためにそれを PinSheet バンドルへ持ち込むと、バンドル増・タイムゾーン/祝日/例外処理の論点が増える。badge 1個に見合わない。確実に常時開放と分かる正準形 `24/7` のみ true。`24/7; PH off`(祝日例外あり)を true にすると例外が消える false positive になるため、**接尾辞付きは true にしない**。それ以外は false → 生文字列を安全に見せる。
- PinSheet:
  - バッジ行(universal の次)に `is24h(toilet.opening_hours)` なら「24時間」バッジ(sky 系色で washlet/emerald と区別)。
  - 星評価行の直後に、`!isInferred && toilet.opening_hours && !is24h(toilet.opening_hours)` のとき `Clock` アイコン + 「{openingHoursLabel}: {hours}」行。`break-words` / `overflow-wrap:anywhere` で長い OSM 文字列のはみ出しを防ぐ。
    - **WHY(ガードの意味)**: `isInferred = (source === "inferred" && review_count === 0)` = 既存の推定警告(158-167)が出るピン。そのピンは警告内で既に hours を表示済み。`is24h` のときはバッジで足りる。両者を二重表示しないためのガード(「非推定」=単なる `source !== "inferred"` ではなく、上記 `isInferred` が false の意)。
  - i18n: `pinSheet.open24h`="24時間"、`pinSheet.openingHoursLabel`="営業時間"(4言語)。

### 要素2: 日本のトイレ使い方ガイド(折り畳み)
- PinSheet の操作ボタン群の下に native `<details>`:
  - `<summary>`: `Info` アイコン + `onboarding.etiquetteTitle`。`focus-visible` の可視リング styling を付ける(キーボード操作 a11y)。
  - 本文: `etiquetteSit` / `etiquettePaper` / `etiquetteFlush` / `etiquetteNoStand` を `<ul>` 表示。
  - 開閉は **state 管理**: `useState(locale !== routing.defaultLocale)` を初期値に、`<details open={guideOpen} onToggle={(e) => setGuideOpen(e.currentTarget.open)}>`。**初期だけ非 ja オープン**、以後はユーザー操作を尊重。
    - **WHY(初期値の根拠)**: 日本在住(ja)はマナー既知 → 畳む。訪日外国人想定(非 ja)は LIXIL 調査で47%が操作不明 → 既定で開いて摩擦を減らす。3タップ動線は阻害しない(既に開いた詳細内の付加情報)。
    - **WHY(state にする理由 = R1 指摘#3)**: native `<details>` に `open` prop を毎レンダー渡すと、お気に入り/共有等の state 変更で PinSheet 再レンダー時に、ユーザーが閉じたガイドが再び開いてしまう。`onToggle` で DOM 開閉を state に同期し、ユーザー操作を破壊しない。
  - コピーは `onboarding.etiquette*` を **再利用**(WHY: 既に4言語翻訳済みの単一ソース。pinSheet 側に複製すると将来の文言ドリフトを生む)。`useTranslations("onboarding")` を追加。
  - 新規 i18n キー不要(summary は etiquetteTitle を流用)。

### 要素3: ルート案内 `?origin=userPos` — **ドロップ**
- **判断**: 採用しない。Google Maps `dir/?api=1&destination=` は **origin 未指定時にデバイスのライブ現在地を自動採用**する。Loo map の `userPos`(GPS 取得時点で固定、移動で陳腐化しうる)を `&origin=` に注入すると、かえって古い起点のルートになり得る。
- PinSheet の `mapsHref` 付近に **WHY コメント**を残し、将来の AI が「親切心で origin を足す」改悪をしないよう明文化する。

### 要素4: PinSheet の高さ/スクロール制御(R1 指摘#4)
- 現状 `PinSheet.tsx:81` のシートは `absolute inset-x-0 bottom-0` で **max-height もスクロールも無い**。営業時間行 + 使い方ガイド(非 ja 既定オープン)で内容が増え、小型モバイルで上方向にはみ出し、上部見出しや操作ボタンが見切れる懸念。
- 対応: シート(またはその内側コンテンツ)に `max-h-[85vh]` + `overflow-y-auto` を付与し、内容超過時はシート内スクロールにする。操作ボタン(ここに行く/評価)が常に到達可能であることを実機/ビルドで確認。
- **WHY**: ボトムシートが画面外へ伸びると 3 タップ動線(ピンタップ → 詳細 → 行動)が壊れる。内部スクロールで詳細量に依らず操作可能を担保。

### テスト
- `src/lib/openingHours.test.ts`: `is24h` を正常/異常/境界で網羅。**R1 反映後の期待値**:
  - `"24/7"`→true、`" 24/7 "`(前後空白)→true
  - `"24/7; PH off"`→**false**(例外付きは生文字列を見せる)、`"24/7 open"`→**false**(接尾辞付き)
  - `"Mo-Fr 09:00-17:00"`→false、`"08:00-22:00"`→false、`"24 hours"`→false
  - `""`→false、`null`→false、`undefined`→false

---

## 詳細タスク一覧

ステータス凡例: ⬜未着手 🔄進行中 ✅完了 ⏸️保留 ❌中止

### フェーズ1: 計画・Codex 承認
| # | タスク | 状態 | 備考 |
|---|---|---|---|
| 1.1 | 設計書作成(本ファイル) | ✅ | |
| 1.2 | Codex プラン承認(≤5往復) | 🔄 | adversarial、完全同意まで |

### フェーズ2: 実装
| # | タスク | 状態 | 対象 | 詳細 |
|---|---|---|---|---|
| 2.1 | `openingHours.ts` 作成 | ⬜ | `src/lib/openingHours.ts` | `is24h` + 厚い WHY コメント |
| 2.2 | PinSheet に 24h バッジ + 営業時間行 | ⬜ | `PinSheet.tsx` | 重複表示ガード |
| 2.3 | PinSheet に使い方ガイド `<details>` | ⬜ | `PinSheet.tsx` | 非ja既定オープン |
| 2.4 | mapsHref に WHY コメント(origin ドロップ) | ⬜ | `PinSheet.tsx` | |
| 2.5 | i18n 4ファイル追加 | ⬜ | `messages/*.json` | open24h / openingHoursLabel |

### フェーズ3: テスト
| # | タスク | 状態 | 対象 | 観点 |
|---|---|---|---|---|
| 3.1 | `is24h` 単体テスト | ✅ | `openingHours.test.ts` | 正常/異常/境界 10ケース |
| 3.2 | lint / build / test | ✅ | — | 全パス(vitest 49/49・lint clean・build OK) |

### フェーズ4: レビュー・完了
| # | タスク | 状態 | 備考 |
|---|---|---|---|
| 4.1 | Codex コード差分承認 | ✅ | `review --scope working-tree`: correctness issue なし |
| 4.2 | Codex テスト結果承認 | ✅ | APPROVE(純関数切り出し妥当・カバレッジ十分) |
| 4.3 | PR 作成(日本語・自動生成マーク) | 🔄 | 本タスクで実行 |
| 4.4 | マージ | 🔄 | main 自動デプロイ OFF=本番反映なし |

---

## 作業ログ

### 2026-06-20
- **実施**: deep-research 完了 → 競合/ポテンシャル記事化 → コードベース調査(属性フィルタ・ルート案内は実装済みと判明)→ スコープを「PinSheet 実用情報+インバウンド使い方」に確定 → 本設計書作成
- **進捗サマリ**: フェーズ1 着手、Codex プラン承認待ち
- **ブロッカー**: なし
- **Codex プランレビュー R1**: REQUEST_CHANGES。5指摘(①is24h厳格化 ②opening_hours依存は既存と訂正 ③details を state 制御 ④モバイル高さ制御 ⑤「非推定」を isInferred 条件に厳密化)を**全採用**しプラン反映済み。R2 再レビューへ。
- **Codex プランレビュー R2**: 4/5解消、line39 の依存記述取り残し1点 → 修正。R3 へ。
- **Codex プランレビュー R3**: **APPROVE**(3往復で収束、上限5以内)。
- **実装(coder)**: openingHours.ts(+test)・PinSheet.tsx・messages×4 を実装。WHY コメント多めの新ルール準拠。
- **Codex 差分レビュー**: `review --scope working-tree` で correctness issue なし。※Codex 環境の vitest は mise PATH 不在で exit 1 になったが、メインの正しい PATH で **49/49 pass** を確認済み(env 問題でコードは健全)。
- **テスト**: vitest 49/49・lint clean・build OK。
- **Codex テスト結果レビュー**: **APPROVE**(純関数切り出し妥当・false positive 回避の false ケース厚め妥当)。
- **進捗サマリ(最終)**: 全 Codex ゲート完全承認。PR 作成 → マージへ。

---

## 決定事項
| 日付 | 決定 | 理由 |
|---|---|---|
| 2026-06-20 | 今夜は migration 不要の frontend/i18n のみに限定 | 無人での本番 Supabase 適用+スモークは危険。main 自動デプロイ OFF と整合 |
| 2026-06-20 | route `?origin=userPos` をドロップ | Google Maps が origin 未指定でライブ現在地を採用。陳腐化した userPos 注入は改悪リスク |
| 2026-06-20 | 使い方コピーは `onboarding.etiquette*` を再利用 | 4言語翻訳済みの単一ソース。複製は文言ドリフトの元 |
| 2026-06-20 | 24h 判定は **完全一致のみ**(`=== "24/7"`)に厳格化(R1#1) | `24/7; PH off` を true にすると祝日例外情報を隠す false positive。接尾辞付きは生文字列表示に回す |
| 2026-06-20 | `opening_hours` 依存は既存(package.json)だがクライアントには持ち込まない(R1#2) | バンドル増・TZ/祝日/例外処理の複雑性。badge 判定には小さい純関数で十分 |
| 2026-06-20 | 使い方ガイドの開閉は `useState`+`onToggle` 制御(R1#3) | `open` prop 毎レンダー渡しは再レンダーでユーザーが閉じたガイドを再オープンする |
| 2026-06-20 | PinSheet に `max-h-[85vh]`+`overflow-y-auto`(R1#4) | 内容増で小型モバイルがはみ出し操作ボタン見切れを防ぐ |
