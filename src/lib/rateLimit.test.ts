import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkAndRecord,
  makeCoordKey,
  peekAttempts,
  recordAttempt,
} from "@/lib/rateLimit";

// TESTS-2.md §1。座標バケットキー(geohash 相当 = 小数3桁丸め)と IP rate limit の単体。
describe("makeCoordKey — 座標バケット", () => {
  describe("正常系", () => {
    it("N1: 近接2座標(同バケット) → 同一キー", () => {
      const a = makeCoordKey(33.5901, 130.40171);
      const b = makeCoordKey(33.59014, 130.40174);
      expect(a).toBe(b);
      expect(a).toBe("33.590,130.402");
    });
  });

  describe("異常系", () => {
    it("E2: lat が NaN → throw(呼び出し側で 400 にする)", () => {
      expect(() => makeCoordKey(Number.NaN, 130.4)).toThrow();
    });

    it("E2': lng が Infinity → throw", () => {
      expect(() => makeCoordKey(33.5, Number.POSITIVE_INFINITY)).toThrow();
    });
  });

  describe("境界値", () => {
    it("B1: バケット境界を跨ぐ2座標 → 別キー(dedup は実距離 ST_DWithin 側で吸収)", () => {
      const a = makeCoordKey(33.5904, 130.4017);
      const b = makeCoordKey(33.5916, 130.4032);
      expect(a).not.toBe(b);
    });
  });
});

describe("checkAndRecord — IP rate limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("N2: 初回呼び出し → ok:true", () => {
    const r = checkAndRecord("ip-n2", "submission:33.100,130.100");
    expect(r.ok).toBe(true);
  });

  it("E1: 窓内に同 IP×同キー再呼び出し → ok:false, retryAfterSec>0", () => {
    const key = "submission:33.200,130.200";
    expect(checkAndRecord("ip-e1", key).ok).toBe(true);
    const second = checkAndRecord("ip-e1", key);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.retryAfterSec).toBeGreaterThan(0);
  });

  it("B2: 窓(1時間)経過後 → ok:true(解放)", () => {
    const key = "submission:33.300,130.300";
    expect(checkAndRecord("ip-b2", key).ok).toBe(true);
    // WINDOW_MS = 1時間 を 1ms 超過
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(checkAndRecord("ip-b2", key).ok).toBe(true);
  });

  it("異なる IP は独立(同キーでも干渉しない)", () => {
    const key = "submission:33.400,130.400";
    expect(checkAndRecord("ip-a", key).ok).toBe(true);
    expect(checkAndRecord("ip-b", key).ok).toBe(true);
  });
});

// ログイン用カウンタ式 limiter(窓内 N 回まで許容 + 失敗時のみ枠を消費)。
// WHY 別 limiter: checkAndRecord は「窓内 1 回」で、ログインに使うと typo 1 回で ~1 時間ロックアウト(可用性回帰)。
describe("peekAttempts / recordAttempt — ログイン用カウンタ式", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const OPTS = { max: 3, windowMs: 15 * 60 * 1000 };

  it("初回は ok・記録ゼロでも弾かれない", () => {
    expect(peekAttempts("ip-pa1", "admin-login", OPTS).ok).toBe(true);
  });

  it("max 回までの失敗記録は ok、超過で 429(retryAfterSec>0)", () => {
    const ip = "ip-pa2";
    // max=3 まで失敗を記録しても peek は ok のまま。
    for (let i = 0; i < OPTS.max; i++) {
      expect(peekAttempts(ip, "admin-login", OPTS).ok).toBe(true);
      recordAttempt(ip, "admin-login", OPTS);
    }
    // 4 回目の失敗試行前の peek で上限到達 → 拒否。
    const blocked = peekAttempts(ip, "admin-login", OPTS);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("成功(record しない)では枠が減らない = 連続成功で締め出されない", () => {
    const ip = "ip-pa3";
    // recordAttempt を一切呼ばずに peek を何度繰り返しても ok のまま(成功ログインを模す)。
    for (let i = 0; i < 10; i++) {
      expect(peekAttempts(ip, "admin-login", OPTS).ok).toBe(true);
    }
  });

  it("窓経過で枠がリセットされる(typo してもしばらく待てば再試行可)", () => {
    const ip = "ip-pa4";
    for (let i = 0; i < OPTS.max; i++) recordAttempt(ip, "admin-login", OPTS);
    expect(peekAttempts(ip, "admin-login", OPTS).ok).toBe(false);
    vi.advanceTimersByTime(OPTS.windowMs + 1);
    expect(peekAttempts(ip, "admin-login", OPTS).ok).toBe(true);
  });

  it("異なる IP は独立(片方のロックがもう片方に波及しない)", () => {
    for (let i = 0; i < OPTS.max; i++) recordAttempt("ip-pa5a", "admin-login", OPTS);
    expect(peekAttempts("ip-pa5a", "admin-login", OPTS).ok).toBe(false);
    expect(peekAttempts("ip-pa5b", "admin-login", OPTS).ok).toBe(true);
  });
});
