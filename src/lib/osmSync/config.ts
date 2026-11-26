// 週次 OSM 同期の上限。数値の根拠はここが唯一の定義箇所。
//
// Vercel Hobby の Function 最大実行時間は 60 秒（maxDuration も 60）。
// 予算は 45 秒で打ち切り、プラットフォームに殺される前にカーソルを保存する。
// Overpass 公開インスタンスへの礼儀として、1 実行あたりのクエリ数も頭打ちにする。
// 1 クエリのクライアント中断は 12 秒、サーバー側 [timeout:] はそれより短い 10 秒。
// 失敗したクエリは同一実行内で指数バックオフし、それでもダメならカーソルを進めずに
// 次回（翌週）の実行が同じ地点から再開する。

export const OSM_SYNC_MAX_DURATION_SEC = 60;
export const OSM_SYNC_BUDGET_MS = 45_000;
export const OSM_SYNC_MAX_QUERIES = 4;
export const OSM_SYNC_ATTEMPT_TIMEOUT_MS = 12_000;
export const OSM_SYNC_OVERPASS_TIMEOUT_SEC = 10;
export const OSM_SYNC_MAX_ATTEMPTS = 3;
export const OSM_SYNC_GAP_MS = 1_500;
export const OSM_SYNC_MAX_TILE_DEPTH = 2;
export const OSM_SYNC_MAX_CONSECUTIVE_FAILURES = 4;
export const OSM_SYNC_APPLY_CHUNK = 200;
export const OSM_SYNC_LOOKUP_CHUNK = 1_000;
export const OSM_SYNC_LEASE_SECONDS = 90;

// 名前・営業時間の異常値で行全体を落とさないための上限。
// opening_hours は途中で切ると式が壊れるので、上限超えは「値なし」として無視する。
export const OSM_SYNC_MAX_NAME_LEN = 300;
export const OSM_SYNC_MAX_HOURS_LEN = 500;

// 座標の更新しきい値。約 1m。同じ点の再書き込みを避ける。
export const OSM_SYNC_LOCATION_EPS = 1e-5;
