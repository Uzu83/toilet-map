import { describe, expect, it } from "vitest";
import { usableToiletName } from "@/lib/toiletName";

describe("usableToiletName", () => {
  it("returns null for null, undefined, and empty/whitespace strings", () => {
    expect(usableToiletName(null)).toBeNull();
    expect(usableToiletName(undefined)).toBeNull();
    expect(usableToiletName("")).toBeNull();
    expect(usableToiletName("   ")).toBeNull();
    expect(usableToiletName("　")).toBeNull(); // Full-width space
  });

  it("returns null for strings consisting solely of typical inferred category labels in parentheses", () => {
    expect(usableToiletName("(駅)")).toBeNull();
    expect(usableToiletName("（駅）")).toBeNull();
    expect(usableToiletName("(ショッピングモール・百貨店)")).toBeNull();
    expect(usableToiletName("(公民館・図書館・市民施設)")).toBeNull();
    expect(usableToiletName("(観光案内所)")).toBeNull();
  });

  it("returns null for HTTP/HTML error texts", () => {
    expect(usableToiletName("404 Not Found")).toBeNull();
    expect(usableToiletName("404")).toBeNull();
    expect(usableToiletName("500 Internal Server Error")).toBeNull();
    expect(usableToiletName("<html>error")).toBeNull();
  });

  it("keeps valid strings containing unbalanced parentheses", () => {
    expect(usableToiletName("西鉄天神高速バスターミナル)")).toBe("西鉄天神高速バスターミナル)");
  });

  it("keeps normal toilet names", () => {
    expect(usableToiletName("博多駅前公衆トイレ")).toBe("博多駅前公衆トイレ");
  });

  it("does not drop names that match category labels but lack parentheses", () => {
    expect(usableToiletName("駅")).toBe("駅");
    expect(usableToiletName("観光案内所")).toBe("観光案内所");
  });

  it("trims whitespace from valid strings", () => {
    expect(usableToiletName("  公園トイレ  ")).toBe("公園トイレ");
    expect(usableToiletName("　地下鉄駅トイレ　")).toBe("地下鉄駅トイレ");
  });
});
