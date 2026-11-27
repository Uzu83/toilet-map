import { describe, expect, it } from "vitest";
import type { OsmToiletNode } from "@/lib/osm";
import { INITIAL_CURSOR, type OsmSyncCursor } from "@/lib/osmSync/cursor";
import type { ExistingToilet, OsmSyncOp } from "@/lib/osmSync/policy";
import { runOsmSyncChunk, type ApplyCounts } from "@/lib/osmSync/run";

function node(osmId: number, overrides: Partial<OsmToiletNode> = {}): OsmToiletNode {
  return {
    osmId,
    lat: 33.59,
    lng: 130.4,
    name: `toilet-${osmId}`,
    hasWashlet: true,
    hasPaper: null,
    hasSoap: null,
    hasDiaperTable: null,
    isUniversal: null,
    openingHours: null,
    source: "osm",
    inferredAccess: null,
    ...overrides,
  };
}

function existingUser(osmId: number): ExistingToilet {
  return {
    osmId,
    source: "user",
    name: "利用者のトイレ",
    lat: 33.59,
    lng: 130.4,
    hasWashlet: true,
    hasPaper: true,
    hasSoap: null,
    hasDiaperTable: null,
    isUniversal: null,
    inferredAccess: "ask",
    openingHours: null,
    protected: ["name"],
  };
}

const ZERO: ApplyCounts = {
  inserted: 0,
  updated: 0,
  skippedUser: 0,
  skippedProtected: 0,
  unchanged: 0,
  skippedInvalid: 0,
};

describe("runOsmSyncChunk", () => {
  it("予算内の成功分だけ県を進め、user 行は apply に渡さない", async () => {
    const applied: OsmSyncOp[] = [];
    let clock = 0;
    const result = await runOsmSyncChunk({
      cursor: INITIAL_CURSOR,
      maxQueries: 2,
      budgetMs: 60_000,
      gapMs: 0,
      now: () => clock,
      sleep: async () => {},
      fetchToilets: async ({ code }) => {
        clock += 1000;
        return code === "JP-01"
          ? [node(1), node(2, { hasWashlet: null, name: null })]
          : [node(3)];
      },
      lookup: async (ids) => (ids.includes(2) ? [existingUser(2)] : []),
      apply: async (ops) => {
        applied.push(...ops);
        return { ...ZERO, inserted: ops.length };
      },
    });

    expect(result.status).toBe("ok");
    expect(result.queries).toBe(2);
    expect(result.prefectureCodes).toEqual(["JP-01", "JP-02"]);
    expect(result.cursor.prefectureIndex).toBe(2);
    expect(result.skippedUser).toBe(1);
    expect(applied.map((op) => op.osm_id)).toEqual([1, 3]);
    expect(applied.some((op) => op.op === "update" && "has_washlet" in op.set && op.set.has_washlet == null)).toBe(
      false,
    );
    const userTouched = applied.some((op) => op.osm_id === 2);
    expect(userTouched).toBe(false);
  });

  it("失敗はバックオフして再試行し、成功したらその県を進める", async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await runOsmSyncChunk({
      cursor: INITIAL_CURSOR,
      maxQueries: 1,
      maxAttempts: 3,
      budgetMs: 60_000,
      attemptTimeoutMs: 1000,
      now: () => 0,
      sleep: async (ms) => {
        delays.push(ms);
      },
      fetchToilets: async () => {
        calls += 1;
        if (calls < 3) throw new Error("Overpass timeout");
        return [node(9)];
      },
      lookup: async () => [],
      apply: async () => ({ ...ZERO, inserted: 1 }),
    });

    expect(calls).toBe(3);
    expect(delays).toEqual([500, 1000]);
    expect(result.status).toBe("ok");
    expect(result.cursor.prefectureIndex).toBe(1);
    expect(result.error).toBeNull();
  });

  it("時間切れが続くと同じ県を分割したカーソルを返す", async () => {
    const result = await runOsmSyncChunk({
      cursor: INITIAL_CURSOR,
      maxQueries: 1,
      maxAttempts: 1,
      budgetMs: 60_000,
      fetchToilets: async () => {
        throw new Error("mirror -> timeout");
      },
      lookup: async () => [],
      apply: async () => ZERO,
    });

    expect(result.status).toBe("error");
    expect(result.cursor.prefectureIndex).toBe(0);
    expect(result.cursor.tiles).toHaveLength(4);
    expect(result.cursor.consecutiveFailures).toBe(0);
  });

  it("429 は分割せず、失敗回数だけ増やす", async () => {
    const result = await runOsmSyncChunk({
      cursor: INITIAL_CURSOR,
      maxQueries: 4,
      maxAttempts: 1,
      budgetMs: 60_000,
      fetchToilets: async () => {
        throw new Error("429 Too Many Requests");
      },
      lookup: async () => [],
      apply: async () => ZERO,
    });

    expect(result.cursor.tiles).toBeNull();
    expect(result.cursor.prefectureIndex).toBe(0);
    expect(result.cursor.consecutiveFailures).toBe(1);
    expect(result.queries).toBe(1);
  });

  it("予算が次のクエリに足りなければ、成功した分で止まる", async () => {
    let clock = 0;
    const codes: string[] = [];
    const result = await runOsmSyncChunk({
      cursor: INITIAL_CURSOR,
      maxQueries: 4,
      budgetMs: 5_000,
      attemptTimeoutMs: 4_000,
      gapMs: 0,
      now: () => clock,
      sleep: async () => {},
      fetchToilets: async ({ code }) => {
        codes.push(code);
        clock += 3_000;
        return [];
      },
      lookup: async () => [],
      apply: async () => ZERO,
    });

    expect(codes).toEqual(["JP-01"]);
    expect(result.queries).toBe(1);
    expect(result.status).toBe("ok");
    expect(result.cursor.prefectureIndex).toBe(1);
  });

  it("apply に delete を渡さない", async () => {
    const ops: OsmSyncOp[] = [];
    await runOsmSyncChunk({
      cursor: { ...INITIAL_CURSOR } satisfies OsmSyncCursor,
      maxQueries: 1,
      budgetMs: 60_000,
      gapMs: 0,
      fetchToilets: async () => [node(4, { hasWashlet: null })],
      lookup: async () => [],
      apply: async (part) => {
        ops.push(...part);
        return { ...ZERO, inserted: part.length };
      },
    });
    expect(ops.every((op) => op.op === "insert" || op.op === "update")).toBe(true);
    expect(JSON.stringify(ops)).not.toContain('"op":"delete"');
  });
});
