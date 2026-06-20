import { describe, expect, it } from "vitest";
import { is24h } from "@/lib/openingHours";

// 設計書(PROGRESS-pinsheet-inbound.md §テスト)の期待値を網羅。
// 方針: 正準形 `24/7`(前後空白許容)のみ true。接尾辞・例外付きは false にして
// 生文字列を営業時間行に見せる(祝日例外を隠す false positive を防ぐ)。
describe("is24h — 24時間営業判定", () => {
  describe("true になる(正準形のみ)", () => {
    it("'24/7' → true", () => {
      expect(is24h("24/7")).toBe(true);
    });
    it("前後空白 ' 24/7 ' → true(trim で正規化)", () => {
      expect(is24h(" 24/7 ")).toBe(true);
    });
  });

  describe("false になる(接尾辞・例外付きは生文字列を見せる)", () => {
    it("'24/7; PH off'(祝日休業の例外付き) → false", () => {
      expect(is24h("24/7; PH off")).toBe(false);
    });
    it("'24/7 open'(接尾辞付き) → false", () => {
      expect(is24h("24/7 open")).toBe(false);
    });
  });

  describe("false になる(そもそも 24h でない営業時間)", () => {
    it("'Mo-Fr 09:00-17:00' → false", () => {
      expect(is24h("Mo-Fr 09:00-17:00")).toBe(false);
    });
    it("'08:00-22:00' → false", () => {
      expect(is24h("08:00-22:00")).toBe(false);
    });
    it("'24 hours'(自然言語表記、OSM 正準形でない) → false", () => {
      expect(is24h("24 hours")).toBe(false);
    });
  });

  describe("false になる(空・未設定)", () => {
    it("'' → false", () => {
      expect(is24h("")).toBe(false);
    });
    it("null → false", () => {
      expect(is24h(null)).toBe(false);
    });
    it("undefined → false", () => {
      expect(is24h(undefined)).toBe(false);
    });
  });
});
