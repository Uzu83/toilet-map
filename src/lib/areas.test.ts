import { describe, expect, it } from "vitest";
import {
  findArea,
  areaMapView,
  findContainingArea,
  findContainingPrefecture,
} from "@/lib/areas";

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

describe("findContainingArea", () => {
  it("港区役所(Issue #57)は東京23区になり、千葉県にはしない", () => {
    const area = findContainingArea(35.6580389, 139.7515632);
    expect(area?.slug).toBe("tokyo-23");
    // 都道府県 bbox の先頭一致だと千葉県(JP-12)になる座標
    expect(findContainingPrefecture(35.6580389, 139.7515632)?.slug).toBe("jp-12");
  });

  it("東京23区内の各地は tokyo-23 になる", () => {
    const points: [number, number, string][] = [
      [35.681236, 139.767125, "東京駅"],
      [35.729503, 139.7109, "池袋"],
      [35.7378, 139.654, "練馬"],
      [35.6647, 139.8592, "西葛西"],
      [35.5624, 139.7161, "蒲田"],
      [35.7585, 139.6288, "光が丘"],
      [35.7696, 139.8707, "金町"],
    ];
    for (const [lat, lng, label] of points) {
      expect(findContainingArea(lat, lng)?.slug, label).toBe("tokyo-23");
    }
  });

  it("23区外は従来の都道府県判定と同じになる", () => {
    const outside: [number, number, string][] = [
      [35.7876617, 139.9032737, "松戸市役所"],
      [35.804244, 139.520533, "所沢"],
      [35.5518863, 139.5418944, "市が尾駅"],
      [35.6523001, 139.5440276, "調布駅"],
    ];
    for (const [lat, lng, label] of outside) {
      expect(findContainingArea(lat, lng)?.slug, label).toBe(
        findContainingPrefecture(lat, lng)?.slug,
      );
    }
  });

  it("他都道府県の代表点は正しい都道府県になる", () => {
    expect(findContainingArea(35.6051, 140.1233)?.slug).toBe("jp-12"); // 千葉市中央
    expect(findContainingArea(35.804244, 139.520533)?.slug).toBe("jp-11"); // 所沢
    expect(findContainingArea(35.4659, 139.6223)?.slug).toBe("jp-14"); // 横浜駅
    expect(findContainingArea(35.6523001, 139.5440276)?.slug).toBe("jp-13"); // 調布駅(都内・23区外)
    expect(findContainingArea(33.5904, 130.4204)?.slug).toBe("jp-40"); // 博多駅
    expect(findContainingArea(34.6628, 135.5019)?.slug).toBe("jp-27"); // 難波
    expect(findContainingArea(43.0686, 141.3508)?.slug).toBe("jp-01"); // 札幌駅
    expect(findContainingArea(26.2123, 127.6792)?.slug).toBe("jp-47"); // 那覇
  });
});
