import { describe, expect, it } from "vitest";
import { HAKATA_STATION, haversineMeters } from "@/lib/geo";
import {
  parseNominatimSearchOrigin,
  resolveListOrigin,
  shouldFlyToGps,
} from "@/lib/listOrigin";

const HAKATA = HAKATA_STATION;
const SHINJUKU_ORIGIN = { lat: 35.69, lng: 139.7, label: "新宿駅" };
const SHINJUKU_TOILET = { lat: 35.691, lng: 139.701 };

describe("resolveListOrigin", () => {
  it("ac-1: searchOrigin あり + distanceMode=here → GPS（無ければ博多）", () => {
    const origin = resolveListOrigin({
      distanceMode: "here",
      userPos: HAKATA,
      searchOrigin: SHINJUKU_ORIGIN,
    });
    expect(origin).toEqual(HAKATA);
    const d = haversineMeters(origin, SHINJUKU_TOILET);
    expect(d).toBeGreaterThan(800_000);
    expect(d).toBeLessThan(950_000);
  });

  it("ac-1: searchOrigin あり + distanceMode=here + userPos なし → 博多", () => {
    const origin = resolveListOrigin({
      distanceMode: "here",
      userPos: null,
      searchOrigin: SHINJUKU_ORIGIN,
    });
    expect(origin).toEqual(HAKATA);
  });

  it("ac-2: distanceMode=search + 新宿原点 → 新宿のトイレは 2km 未満", () => {
    const origin = resolveListOrigin({
      distanceMode: "search",
      userPos: HAKATA,
      searchOrigin: SHINJUKU_ORIGIN,
    });
    const d = haversineMeters(origin, SHINJUKU_TOILET);
    expect(d).toBeLessThan(2000);
    expect(d).toBeLessThan(800_000);
  });

  it("distanceMode=search でも searchOrigin が無ければ GPS/博多", () => {
    expect(
      resolveListOrigin({ distanceMode: "search", userPos: HAKATA, searchOrigin: null })
    ).toEqual(HAKATA);
  });
});

describe("shouldFlyToGps", () => {
  it("ac-5: searchOrigin なし → flyTo してよい", () => {
    expect(shouldFlyToGps(null)).toBe(true);
  });

  it("ac-5: searchOrigin あり → flyTo しない", () => {
    expect(shouldFlyToGps(SHINJUKU_ORIGIN)).toBe(false);
  });
});

describe("parseNominatimSearchOrigin", () => {
  it("Nominatim 結果から searchOrigin を組み立てる", () => {
    expect(
      parseNominatimSearchOrigin({
        lat: "35.69",
        lon: "139.70",
        display_name: "新宿駅, 新宿区, 東京都, 日本",
        name: "新宿駅",
      })
    ).toEqual({ lat: 35.69, lng: 139.7, label: "新宿駅" });
  });

  it("座標が不正なら null", () => {
    expect(
      parseNominatimSearchOrigin({
        lat: "bad",
        lon: "139.70",
        display_name: "x",
      })
    ).toBeNull();
  });
});
