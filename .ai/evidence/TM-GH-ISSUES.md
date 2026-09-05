# TM-GH-ISSUES 受入証拠

date: 2026-09-06
branch: auto/fix-github-issues-2026-09-06
local: http://localhost:3001

## 判定

| AC | 結果 | 証拠 |
|---|---|---|
| ac-27 | pass | `usableToiletName` テスト。リスト/地図に `(駅)` は出ず「名称未設定のトイレ」 |
| ac-27b | pass | ToiletList/PinSheet/toiletDisplayName が sanitizer 経由 |
| ac-32 | pass | osm inferred は name=null。表示側で 404 を unnamed。本番行の物理削除はしない |
| ac-28 | pass（コード） | LocateControl 8s timeout + locateDeniedBanner。AutoLocate はオンボーディング後。拒否ダイアログ自体はブラウザ依存で今回は未操作 |
| ac-29 | pass | ピン詳細中に「トイレを追加」なし。「評価する」でレビューフォームが開く |
| ac-30 | pass（コード） | EmptyState を検索バー下へ、内側 pointer-events-none |
| ac-31 | pass | `/area/sapporo` CTA `/?lat=43.065&lng=141.35&zoom=13`。地図に札幌ピン（さとらんど/アリオ札幌） |
| ac-34 | pass（コード） | SearchBar.select が `select(null)`。距離 mode は触らない |
| ac-35 | pass | `zzzzqqqqxxxx` Enter →「場所を見つけられませんでした」 |
| ac-36 | pass | `/?id=00000000-…` で案内 + 地図に戻る。URL は操作まで残る |
| ac-reg | pass | lint / tsc / test 265 / build |

## #33

コード変更なし。TM-DIST 済み（リストに「この地点から測る」）。距離既定は GPS/博多のまま。Issue 期待の自動切替はオーナー決定と矛盾するためスキップ。

## 残

- 本番 DB の `name='404 Not Found'` 行は表示フォールバックのみ。再シード/UPDATE は人間
- #33 を仕様どおり close するかは人間判断
