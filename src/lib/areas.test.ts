import { describe, expect, it } from "vitest";
import { findArea, areaMapView } from "@/lib/areas";

describe("areaMapView", () => {
  it("returns center lat/lng and zoom 13 for a city area", () => {
    const sapporo = findArea("sapporo");
    expect(sapporo).toBeDefined();
    if (!sapporo) return;

    // sapporo bbox: [42.95, 141.20, 43.18, 141.50]
    // center: (42.95 + 43.18) / 2 = 43.065
    // center: (141.20 + 141.50) / 2 = 141.35
    const view = areaMapView(sapporo);
    
    expect(view.lat).toBeCloseTo(43.065);
    expect(view.lng).toBeCloseTo(141.35);
    expect(view.zoom).toBe(13);

    // Ensure it's not Hakata
    expect(view.lat).not.toBeCloseTo(33.5904);
    expect(view.lng).not.toBeCloseTo(130.4204);
  });

  it("returns center lat/lng and zoom 9 for a prefecture area", () => {
    const hokkaido = findArea("jp-01");
    expect(hokkaido).toBeDefined();
    if (!hokkaido) return;

    const view = areaMapView(hokkaido);
    
    // hokkaido bbox in JP_PREFECTURES: [41.3, 139.3, 45.6, 145.9]
    // center: (41.3 + 45.6) / 2 = 43.45
    // center: (139.3 + 145.9) / 2 = 142.6
    expect(view.lat).toBeCloseTo(43.45);
    expect(view.lng).toBeCloseTo(142.6);
    expect(view.zoom).toBe(9);
  });
});
