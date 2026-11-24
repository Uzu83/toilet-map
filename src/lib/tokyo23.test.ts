import { describe, expect, it } from "vitest";
import { isInTokyo23Wards, toiletsForAreaList } from "@/lib/tokyo23";

describe("isInTokyo23Wards", () => {
  it("23区内の地点は含む", () => {
    expect(isInTokyo23Wards(35.681236, 139.767125)).toBe(true); // 東京駅
    expect(isInTokyo23Wards(35.729503, 139.7109)).toBe(true); // 池袋
    expect(isInTokyo23Wards(35.7378, 139.654)).toBe(true); // 練馬
    expect(isInTokyo23Wards(35.6647, 139.8592)).toBe(true); // 西葛西
    expect(isInTokyo23Wards(35.5624, 139.7161)).toBe(true); // 蒲田
    expect(isInTokyo23Wards(35.7585, 139.6288)).toBe(true); // 光が丘
    expect(isInTokyo23Wards(35.7696, 139.8707)).toBe(true); // 金町
  });

  it("Issue #46 で一覧に出ていた23区外は含まない", () => {
    expect(isInTokyo23Wards(35.804244, 139.520533)).toBe(false); // 所沢市立やなぎ児童館
    expect(isInTokyo23Wards(35.5518863, 139.5418944)).toBe(false); // 市が尾駅
    expect(isInTokyo23Wards(35.7738192, 139.8881994)).toBe(false); // 上矢切第三町会公民館
    expect(isInTokyo23Wards(35.7883814, 139.6114802)).toBe(false); // 和光
    expect(isInTokyo23Wards(35.7876617, 139.9032737)).toBe(false); // 松戸市役所
    expect(isInTokyo23Wards(35.6523001, 139.5440276)).toBe(false); // 調布駅
    expect(isInTokyo23Wards(35.51898, 139.633035)).toBe(false); // 港北区役所
  });
});

describe("toiletsForAreaList", () => {
  const rows = [
    { id: "tokyo", lat: 35.681236, lng: 139.767125 },
    { id: "tokorozawa", lat: 35.804244, lng: 139.520533 },
    { id: "ichigao", lat: 35.5518863, lng: 139.5418944 },
    { id: "kamiyagiri", lat: 35.7738192, lng: 139.8881994 },
  ];

  it("tokyo-23 は区外を落とし、区内は残す", () => {
    expect(toiletsForAreaList("tokyo-23", rows, 180).map((t) => t.id)).toEqual(["tokyo"]);
  });

  it("他のエリアは絞らない", () => {
    expect(toiletsForAreaList("fukuoka-city", rows, 180)).toHaveLength(4);
  });

  it("表示件数で切る", () => {
    const inside = [
      { id: "a", lat: 35.681236, lng: 139.767125 },
      { id: "b", lat: 35.729503, lng: 139.7109 },
    ];
    expect(toiletsForAreaList("tokyo-23", inside, 1).map((t) => t.id)).toEqual(["a"]);
  });
});
