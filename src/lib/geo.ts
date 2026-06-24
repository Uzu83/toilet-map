// Phase 0 シードリージョン「福岡市」の中心: 博多駅。
// WHY ここが「フォールバック原点」か:
//   ToiletMap.tsx の MapContainer は GPS 未許可 / 保存位置なし の初期 center に使い、
//   ToiletList.tsx は userPos 未取得時の距離計算起点に使う。両方が同じ定数を参照することで
//   「起動直後の表示領域」と「リスト距離順ソートの基準点」が揃い、初回体験の一貫性を保つ。
//   Phase 1 では福岡市以外も追加されるが、フォールバックの「見せやすさ」を優先して博多駅固定のままでよい
//   (GPS が通れば即 userPos に上書きされるので、大半のユーザーには影響しない)。
export const HAKATA_STATION = { lat: 33.5904, lng: 130.4204 };

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function bearingDeg(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// 8 方位のインデックス (0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW)。
// 文言は i18n の "compass" 配列から引く。
export function bearingIndex(deg: number): number {
  return Math.round(deg / 45) % 8;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

// API ルートで bbox クエリパラメータを検証・パースする共通ヘルパ。
// WHY 共通化するか:
//   api/toilets/route.ts と api/submissions/route.ts が同一の検証ロジックを持っていた。
//   片方だけ直すと「submissions は通るが toilets は弾く」非対称バグが起きる。
//   単一の真実として geo.ts に置き、両ルートがここを参照する。
//
// WHY null 返却(throw しない)か:
//   呼び出し側(API ルート)がどの HTTP ステータスで返すかを決める責任を持つ。
//   ヘルパが throw すると呼び出し側が try/catch で後処理しなければならず、
//   400 を返すべきところに 500 が漏れる可能性がある。null を返して「検証失敗」だけ示す。
//
// フォーマット: "minLng,minLat,maxLng,maxLat"(api/toilets と api/submissions で共通の慣例)
export function parseBbox(raw: string | null): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts as [number, number, number, number];
}
