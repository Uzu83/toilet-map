import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAndRecord, makeCoordKey } from "@/lib/rateLimit";

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
