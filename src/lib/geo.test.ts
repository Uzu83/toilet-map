import { describe, expect, it } from "vitest";
import { haversineMeters, bearingDeg, bearingIndex, formatDistance } from "@/lib/geo";

// H2 — geo.ts の単体テスト(haversine / bearing / formatDistance)
// 全テストは実値を使い、モックなし(純粋関数のみ)。

describe("haversineMeters", () => {
  it("同一点 → 0m", () => {
    const p = { lat: 33.5904, lng: 130.4204 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it("博多駅 → 約1km 北(lat +0.009 ≒ 1000m)", () => {
    const a = { lat: 33.5904, lng: 130.4204 };
    const b = { lat: 33.5994, lng: 130.4204 };
    const d = haversineMeters(a, b);
    // lat 1度 ≒ 111,000m → 0.009度 ≒ 999m。±50m の許容。
    expect(d).toBeGreaterThan(950);
    expect(d).toBeLessThan(1050);
  });
});

describe("bearingDeg", () => {
  const center = { lat: 33.59, lng: 130.42 };

  it("真北(lat 増加) → 約 0°", () => {
    const north = { lat: 33.60, lng: 130.42 };
    const deg = bearingDeg(center, north);
    // bearingDeg は (atan2 + 360) % 360 なので [0, 360) に収まる。
    // 真北の場合は atan2(0, +) ≈ 0° → (0 + 360) % 360 = 0。
    // [0, 5) または [355, 360) のいずれかを受け入れる。
    const isNearNorth = deg < 5 || deg >= 355;
    expect(isNearNorth).toBe(true);
  });

  it("真東(lng 増加) → 約 90°", () => {
    const east = { lat: 33.59, lng: 130.43 };
    const deg = bearingDeg(center, east);
    expect(deg).toBeGreaterThan(85);
    expect(deg).toBeLessThan(95);
  });

  it("真南(lat 減少) → 約 180°", () => {
    const south = { lat: 33.58, lng: 130.42 };
    const deg = bearingDeg(center, south);
    expect(deg).toBeGreaterThan(175);
    expect(deg).toBeLessThan(185);
  });

  it("真西(lng 減少) → 約 270°", () => {
    const west = { lat: 33.59, lng: 130.41 };
    const deg = bearingDeg(center, west);
    expect(deg).toBeGreaterThan(265);
    expect(deg).toBeLessThan(275);
  });

  it("360° ラップ: 戻り値は常に [0, 360)", () => {
    // NW 方向は bearingDeg が大きな値を返すが % 360 で [0, 360) に収まるはず
    const nw = { lat: 33.60, lng: 130.41 };
    const deg = bearingDeg(center, nw);
    expect(deg).toBeGreaterThanOrEqual(0);
    expect(deg).toBeLessThan(360);
  });
});

describe("bearingIndex", () => {
  it("N(北, ~0°) → 0", () => {
    expect(bearingIndex(0)).toBe(0);
    expect(bearingIndex(22)).toBe(0); // round(22/45)=round(0.49)=0
  });

  it("NE(北東, ~45°) → 1", () => {
    expect(bearingIndex(45)).toBe(1);
  });

  it("E(東, ~90°) → 2", () => {
    expect(bearingIndex(90)).toBe(2);
  });

  it("SE(南東, ~135°) → 3", () => {
    expect(bearingIndex(135)).toBe(3);
  });

  it("S(南, ~180°) → 4", () => {
    expect(bearingIndex(180)).toBe(4);
  });

  it("NW(北西, ~315°) → 7", () => {
    expect(bearingIndex(315)).toBe(7);
  });

  it("360° → 0(ラップ: round(360/45)=8, 8%8=0)", () => {
    expect(bearingIndex(360)).toBe(0);
  });
});

describe("formatDistance", () => {
  it("1000m 未満 → メートル表示(整数)", () => {
    expect(formatDistance(500)).toBe("500m");
    expect(formatDistance(999)).toBe("999m");
    expect(formatDistance(0)).toBe("0m");
  });

  it("1000m 以上 → km 表示(小数1桁)", () => {
    expect(formatDistance(1000)).toBe("1.0km");
    expect(formatDistance(1500)).toBe("1.5km");
    expect(formatDistance(10000)).toBe("10.0km");
  });
});
