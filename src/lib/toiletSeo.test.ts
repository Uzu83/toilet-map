import { describe, expect, it } from "vitest";
import type { Toilet } from "@/types/toilet";
import { isToiletIndexable } from "@/lib/toiletSeo";

// Toilet の全カラムを埋めたファクトリ。対象フィールド
// (source / name / review_count / not_a_toilet_count) だけを overrides で上書きする。
function makeToilet(overrides: Partial<Toilet> = {}): Toilet {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    name: "テストトイレ",
    lat: 33.5904,
    lng: 130.4017,
    source: "osm",
    has_washlet: null,
    has_diaper_table: null,
    is_universal: null,
    review_count: 0,
    avg_rating: null,
    dominant_access: null,
    inferred_access: null,
    opening_hours: null,
    not_a_toilet_count: 0,
    ...overrides,
  };
}

// 期待値は設計書 §5.2 真理値表 / TESTS-1.md §1 と一致。
describe("isToiletIndexable — canonical predicate (設計書 §5.1)", () => {
  describe("正常系", () => {
    it("N1: named OSM・未レビュー → true (新シグナルで index 化 = AC1)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "osm",
            name: "博多駅前公衆トイレ",
            review_count: 0,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(true);
    });

    it("N2: named OSM + review=5 → true (named + reviewed 両成立)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "osm",
            name: "公園トイレ",
            review_count: 5,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(true);
    });

    it("N3: inferred・無名・review=3 → true (reviewed は source 不問 = AC4 保護)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "inferred",
            name: null,
            review_count: 3,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(true);
    });
  });

  describe("異常系", () => {
    it("E1: osm + review=2 + not_a_toilet=5 → false (not_a_toilet>=5 は reviewed でも除外)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "osm",
            name: "X",
            review_count: 2,
            not_a_toilet_count: 5,
          }),
        ),
      ).toBe(false);
    });

    it("E2: inferred・named・未レビュー → false (inferred 未レビューは実物非特定で除外)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "inferred",
            name: "○○モール",
            review_count: 0,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(false);
    });

    it("E3: user・無名・未レビュー → false (user 投稿・無名は対象外)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "user",
            name: null,
            review_count: 0,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(false);
    });

    it("E4: osm・無名・未レビュー → false (無名 OSM は thin)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "osm",
            name: null,
            review_count: 0,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(false);
    });
  });

  describe("境界値", () => {
    it("B1: osm・半角空白のみ名 → false (空白のみは非 named)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "osm",
            name: "   ",
            review_count: 0,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(false);
    });

    it('B2: osm・タブ "\\t" 名 → false (JS trim/SQL btrim 差分の固定)', () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "osm",
            name: "\t",
            review_count: 0,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(false);
    });

    it('B3: osm・全角空白 U+3000 "　" 名 → false (JS trim は U+3000 を除去)', () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "osm",
            name: "　",
            review_count: 0,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(false);
    });

    it("B4: osm・named・not_a_toilet=4 (<5 直前) → true", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "osm",
            name: "X",
            review_count: 0,
            not_a_toilet_count: 4,
          }),
        ),
      ).toBe(true);
    });

    it("B5: osm・named・not_a_toilet=5 (閾値) → false", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "osm",
            name: "X",
            review_count: 0,
            not_a_toilet_count: 5,
          }),
        ),
      ).toBe(false);
    });

    it("B6: osm・named・review=1 (>0 直後) → true (reviewed 経路成立)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "osm",
            name: "X",
            review_count: 1,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(true);
    });
  });

  // Phase 2 / Issue #2: ユーザー投稿(source='user')の indexable 挙動。
  // 設計判断「user もレビュー1件以上で indexable に昇格」は review_count>0 ブランチ(source 非依存)で
  // 既に成立する(009 で述語変更なし)。SQL(007) と同一真理値表であること(SQL1 パリティ)を TS 側で固定する。
  describe("Phase 2: source='user' パリティ (TESTS-2.md §5)", () => {
    it("N8: user・named・review=1 → true (レビュー1件で昇格 = 既存ルール踏襲)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "user",
            name: "○○ビルトイレ",
            review_count: 1,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(true);
    });

    it("E15: user・無名・review=0 → false (未レビュー user は inferred と同じ品質ゲートで除外)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "user",
            name: null,
            review_count: 0,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(false);
    });

    it("E15': user・named・review=0 → false (named でも user は osm の named 経路に乗らない)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "user",
            name: "○○ビルトイレ",
            review_count: 0,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(false);
    });

    it("user・review=2・not_a_toilet=5 → false (昇格後も not_a_toilet>=5 で除外 = 自己修正)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "user",
            name: "○○ビルトイレ",
            review_count: 2,
            not_a_toilet_count: 5,
          }),
        ),
      ).toBe(false);
    });
  });

  describe("回帰 (AC4: 既存公開対象が落ちない)", () => {
    it("R1: inferred・無名・review=3 → true (旧 review_count>0 対象の維持 = 最重要退行)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "inferred",
            name: null,
            review_count: 3,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(true);
    });

    it("R2: osm・named・review=10 → true (reviewed+named、従来 indexable のまま)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "osm",
            name: "駅トイレ",
            review_count: 10,
            not_a_toilet_count: 0,
          }),
        ),
      ).toBe(true);
    });

    it("R3: inferred・named・review=4・not_a_toilet=4 → true (reviewed・境界 not_a_toilet=4 も維持)", () => {
      expect(
        isToiletIndexable(
          makeToilet({
            source: "inferred",
            name: "モール",
            review_count: 4,
            not_a_toilet_count: 4,
          }),
        ),
      ).toBe(true);
    });
  });
});
