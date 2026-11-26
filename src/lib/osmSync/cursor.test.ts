import { describe, expect, it } from "vitest";
import { JP_PREFECTURES } from "@/lib/regions";
import {
  applyOutcome,
  cursorPrefecture,
  INITIAL_CURSOR,
  parseCursor,
  splitBBox,
  type OsmSyncCursor,
} from "@/lib/osmSync/cursor";

describe("applyOutcome", () => {
  it("成功すると次の都道府県へ進み、最後の次は先頭に戻る", () => {
    const next = applyOutcome(INITIAL_CURSOR, { type: "success" });
    expect(next.cursor.prefectureIndex).toBe(1);
    expect(next.cursor.tiles).toBeNull();
    expect(cursorPrefecture(next.cursor).code).toBe("JP-02");

    const wrapped = applyOutcome(
      { ...INITIAL_CURSOR, prefectureIndex: JP_PREFECTURES.length - 1 },
      { type: "success" },
    );
    expect(wrapped.cursor.prefectureIndex).toBe(0);
    expect(cursorPrefecture(wrapped.cursor).code).toBe("JP-01");
  });

  it("県全体の時間切れは bbox を 4 分割して同じ県に留まる", () => {
    const outcome = applyOutcome(INITIAL_CURSOR, { type: "timeout" });
    expect(outcome.split).toBe(true);
    expect(outcome.cursor.prefectureIndex).toBe(0);
    expect(outcome.cursor.tiles).toHaveLength(4);
    expect(outcome.cursor.tiles?.[0]?.depth).toBe(1);
    expect(outcome.cursor.consecutiveFailures).toBe(0);
  });

  it("タイルの時間切れはそのタイルだけ掘り、深さ上限ではそのタイルを飛ばす", () => {
    const split = applyOutcome(INITIAL_CURSOR, { type: "timeout" }).cursor;
    const deeper = applyOutcome(split, { type: "timeout" });
    expect(deeper.split).toBe(true);
    expect(deeper.cursor.tiles?.[0]?.depth).toBe(2);
    expect(deeper.cursor.prefectureIndex).toBe(0);

    const skipped = applyOutcome(deeper.cursor, { type: "timeout" });
    expect(skipped.split).toBe(false);
    expect(skipped.skippedUnit).toBe(true);
    expect(skipped.cursor.tiles?.[0]?.depth).toBe(2);
    expect(skipped.cursor.tiles?.length).toBe((deeper.cursor.tiles?.length ?? 0) - 1);
  });

  it("連続失敗は同じ単位に留まり、上限でその単位を飛ばす", () => {
    let cursor: OsmSyncCursor = INITIAL_CURSOR;
    for (let i = 0; i < 3; i += 1) {
      const outcome = applyOutcome(cursor, { type: "failure" });
      expect(outcome.skippedUnit).toBe(false);
      expect(outcome.cursor.prefectureIndex).toBe(0);
      expect(outcome.cursor.consecutiveFailures).toBe(i + 1);
      cursor = outcome.cursor;
    }
    const skipped = applyOutcome(cursor, { type: "failure" });
    expect(skipped.skippedUnit).toBe(true);
    expect(skipped.cursor.prefectureIndex).toBe(1);
    expect(skipped.cursor.consecutiveFailures).toBe(0);
  });

  it("成功したタイルはキューから外し、最後のタイルの次は次の県", () => {
    const split = applyOutcome(INITIAL_CURSOR, { type: "timeout" }).cursor;
    const first = applyOutcome(split, { type: "success" }).cursor;
    expect(first.prefectureIndex).toBe(0);
    expect(first.tiles).toHaveLength(3);

    let cursor = first;
    cursor = applyOutcome(cursor, { type: "success" }).cursor;
    cursor = applyOutcome(cursor, { type: "success" }).cursor;
    cursor = applyOutcome(cursor, { type: "success" }).cursor;
    expect(cursor.prefectureIndex).toBe(1);
    expect(cursor.tiles).toBeNull();
  });
});

describe("parseCursor", () => {
  it("壊れた JSON は先頭からやり直す", () => {
    expect(parseCursor(null).reset).toBe(true);
    expect(parseCursor({ v: 2, prefectureIndex: 3 }).cursor).toEqual(INITIAL_CURSOR);
    expect(parseCursor({ v: 1, prefectureIndex: 99, tiles: null, consecutiveFailures: 0 }).reset).toBe(true);
  });

  it("正しいカーソルはそのまま再開できる", () => {
    const saved = {
      v: 1,
      prefectureIndex: 12,
      tiles: [{ bbox: [35, 139, 36, 140], depth: 1 }],
      consecutiveFailures: 2,
    };
    const parsed = parseCursor(saved);
    expect(parsed.reset).toBe(false);
    expect(parsed.cursor).toEqual(saved);
  });
});

describe("splitBBox", () => {
  it("細すぎる範囲は分割しない", () => {
    expect(splitBBox([35, 139, 35.01, 139.01])).toBeNull();
  });
});
