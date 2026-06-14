// IP ベースの簡易 rate limit
// MVP は in-memory(同一インスタンス内のみ)。Vercel サーバーレスでは
// インスタンスをまたぐと効きが甘くなるが、Phase 1 のスパム防止には十分。
// 厳格化するなら Phase 2 で Supabase の reviews.ip_hash + created_at で判定する。

import { createHash } from "node:crypto";

const WINDOW_MS = 60 * 60 * 1000; // 1時間
const cache = new Map<string, number>(); // key -> last submitted at (ms)

function purge(now: number) {
  for (const [k, ts] of cache) {
    if (now - ts > WINDOW_MS) cache.delete(k);
  }
}

export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? "toilet-map";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export function checkAndRecord(ipHash: string, toiletId: string): RateLimitResult {
  const now = Date.now();
  purge(now);
  const key = `${ipHash}:${toiletId}`;
  const last = cache.get(key);
  if (last && now - last < WINDOW_MS) {
    return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - last)) / 1000) };
  }
  cache.set(key, now);
  return { ok: true };
}

// 記録せずに現在の制限状態だけを見る(非破壊)。
// 申請フローのように「成功時のみ枠を消費したい」ケースで peekLimit → (RPC) → recordHit と分けて使う。
export function peekLimit(ipHash: string, key: string): RateLimitResult {
  const now = Date.now();
  purge(now);
  const last = cache.get(`${ipHash}:${key}`);
  if (last && now - last < WINDOW_MS) {
    return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - last)) / 1000) };
  }
  return { ok: true };
}

// 制限枠を消費する(成功した申請/追認の後にだけ呼ぶ)。
export function recordHit(ipHash: string, key: string): void {
  cache.set(`${ipHash}:${key}`, Date.now());
}

// トイレ申請(Phase 2)用の座標バケットキー。緯度経度を小数 3 桁(≈111m 格子)に丸めて
// 「同一 IP × 同一地点バケット」を checkAndRecord の key に使う(IP rate limit, 多層防御の第 1 層)。
// ※同一地点 5 分スロットル(地点グローバル)は in-memory ではサーバーレスで甘いため DB 側(submit_toilet RPC)に置く。
// 丸め粒度は DB の advisory lock バケットと揃える(008 = round 3 桁)。
export function makeCoordKey(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("invalid coordinates");
  }
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

export function extractIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "0.0.0.0";
}
