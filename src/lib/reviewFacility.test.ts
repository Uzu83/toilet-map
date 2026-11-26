import { describe, expect, it } from "vitest";
import {
  ReviewFacilityValidationError,
  parseReviewFacilities,
} from "./reviewFacility";

describe("parseReviewFacilities", () => {
  it("未送信はすべて null(必須にしない)", () => {
    expect(parseReviewFacilities({}, { notAToilet: false })).toEqual({
      has_paper: null,
      has_washlet: null,
      has_soap: null,
      has_diaper_table: null,
      opening_hours: null,
    });
  });

  it("true/false と営業時間を通す", () => {
    expect(
      parseReviewFacilities(
        {
          hasPaper: true,
          hasWashlet: false,
          hasSoap: true,
          hasDiaperTable: false,
          openingHours: "  9:00-21:00  ",
        },
        { notAToilet: false },
      ),
    ).toEqual({
      has_paper: true,
      has_washlet: false,
      has_soap: true,
      has_diaper_table: false,
      opening_hours: "9:00-21:00",
    });
  });

  it("空の営業時間は null", () => {
    expect(
      parseReviewFacilities({ openingHours: "   " }, { notAToilet: false }).opening_hours,
    ).toBeNull();
  });

  it("bool 以外・長すぎる営業時間は拒否", () => {
    expect(() =>
      parseReviewFacilities({ hasPaper: "yes" }, { notAToilet: false }),
    ).toThrow(ReviewFacilityValidationError);
    expect(() =>
      parseReviewFacilities({ openingHours: "x".repeat(201) }, { notAToilet: false }),
    ).toThrow(ReviewFacilityValidationError);
    expect(() =>
      parseReviewFacilities({ openingHours: 24 }, { notAToilet: false }),
    ).toThrow(ReviewFacilityValidationError);
  });

  it("「ここトイレない」は設備を捨てる", () => {
    expect(
      parseReviewFacilities(
        { hasPaper: true, hasWashlet: true, openingHours: "24/7" },
        { notAToilet: true },
      ),
    ).toEqual({
      has_paper: null,
      has_washlet: null,
      has_soap: null,
      has_diaper_table: null,
      opening_hours: null,
    });
  });

  it("名前・メール・電話は読まない", () => {
    const parsed = parseReviewFacilities(
      { name: "山田", email: "a@example.com", phone: "090", hasSoap: false },
      { notAToilet: false },
    );
    expect(parsed).toEqual({
      has_paper: null,
      has_washlet: null,
      has_soap: false,
      has_diaper_table: null,
      opening_hours: null,
    });
    expect(parsed).not.toHaveProperty("email");
    expect(parsed).not.toHaveProperty("phone");
    expect(parsed).not.toHaveProperty("name");
  });
});
