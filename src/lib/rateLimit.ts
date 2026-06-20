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

// ---------------------------------------------------------------------------
// カウンタ式 limiter(窓内 N 回まで許容)
// ---------------------------------------------------------------------------
// WHY checkAndRecord と別物が要るか: checkAndRecord は「窓内 1 回」セマンティクス(= reviews 用:
//   同一 IP × 同一トイレ = 1 時間 1 件)。これをログインに流用すると「1 時間に 1 回しか試行できない」
//   になり、パスワード 1 回打ち間違え or cookie 失効後の再ログインが ~1 時間ブロックされる
//   = ソロ admin ツールの自己ロックアウト(可用性回帰)。ログインは「失敗を数回までは許す」スロットルが正しい。
// なので「窓内 max 回まで ok、超過で 429」のカウンタ式を別途用意する(in-memory・per-instance は
//   checkAndRecord と同じ制約を持つ = サーバーレスではインスタンス境界で甘くなる。完全な耐性は Phase 2 で DB 化)。
type AttemptRecord = { count: number; windowStart: number };
const attemptCache = new Map<string, AttemptRecord>();

export type AttemptOptions = { max: number; windowMs: number };

// カウンタ式の現在状態だけを見る(非破壊)。記録は recordAttempt 側で行う。
// WHY 分離: login は「すでに上限なら成否判定前に弾く(peekAttempts)」「パスワード照合に失敗したときだけ枠を消費する
//   (recordAttempt)」と分けたい(成功ログインで枠を食わない設計)。
export function peekAttempts(
  ipHash: string,
  key: string,
  opts: AttemptOptions,
): RateLimitResult {
  const now = Date.now();
  const rec = attemptCache.get(`${ipHash}:${key}`);
  if (!rec || now - rec.windowStart >= opts.windowMs) return { ok: true };
  if (rec.count >= opts.max) {
    const retryAfterSec = Math.ceil((opts.windowMs - (now - rec.windowStart)) / 1000);
    return { ok: false, retryAfterSec: Math.max(retryAfterSec, 1) };
  }
  return { ok: true };
}

// 失敗試行を 1 回だけ記録する(窓を跨いだらリセット)。login route が「照合失敗」のときだけ呼ぶ。
export function recordAttempt(ipHash: string, key: string, opts: AttemptOptions): void {
  const now = Date.now();
  const cacheKey = `${ipHash}:${key}`;
  // 期限切れエントリを掃除(再来訪されないキーがメモリに残り続けるのを防ぐ)。記録時にだけ走らせる。
  for (const [k, r] of attemptCache) {
    if (now - r.windowStart >= opts.windowMs) attemptCache.delete(k);
  }
  const rec = attemptCache.get(cacheKey);
  if (!rec || now - rec.windowStart >= opts.windowMs) {
    attemptCache.set(cacheKey, { count: 1, windowStart: now });
    return;
  }
  rec.count += 1;
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
  // Vercel など信頼できるプロキシが付与する x-real-ip(接続元 IP, クライアント詐称不可)を優先する。
  // クライアント供給の x-forwarded-for 先頭は詐称できるため後順位(これに依存した distinct-ip confirm の
  // 水増しを緩和)。完全な Sybil 耐性は Phase 3 の Auth で担保する(PROGRESS 未解決課題 #3)。
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "0.0.0.0";
}
