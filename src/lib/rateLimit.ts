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

export function extractIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "0.0.0.0";
}
