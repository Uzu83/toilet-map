import { describe, expect, it } from "vitest";
import type { OsmToiletNode } from "@/lib/osm";
import { INITIAL_CURSOR } from "@/lib/osmSync/cursor";
import { parseExistingList, type OsmSyncDb } from "@/lib/osmSync/db";
import { executeOsmSync } from "@/lib/osmSync/execute";

function node(osmId: number): OsmToiletNode {
  return {
    osmId,
    lat: 35.68,
    lng: 139.76,
    name: "公衆トイレ",
    hasWashlet: null,
    hasPaper: null,
    hasSoap: null,
    hasDiaperTable: null,
    isUniversal: null,
    openingHours: null,
    source: "osm",
    inferredAccess: null,
  };
}

function fakeDb(options: {
  acquired?: boolean;
  claimError?: { message: string; code?: string };
  existing?: unknown[];
}): { db: OsmSyncDb; calls: { fn: string; args: Record<string, unknown> }[] } {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: OsmSyncDb = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (options.claimError && fn === "osm_sync_claim") {
        return { data: null, error: options.claimError };
      }
      if (fn === "osm_sync_claim") {
        if (options.acquired === false) return { data: { acquired: false }, error: null };
        return {
          data: { acquired: true, cursor: INITIAL_CURSOR, run_id: "11111111-1111-4111-8111-111111111111" },
          error: null,
        };
      }
      if (fn === "osm_sync_lookup") return { data: options.existing ?? [], error: null };
      if (fn === "osm_sync_apply") {
        return {
          data: {
            inserted: 1,
            updated: 0,
            skipped_user: 0,
            skipped_protected: 0,
            unchanged: 0,
            skipped_invalid: 0,
          },
          error: null,
        };
      }
      if (fn === "osm_sync_finish") return { data: null, error: null };
      return { data: null, error: { message: "unexpected rpc" } };
    },
  };
  return { db, calls };
}

describe("parseExistingList", () => {
  it("bigint が文字列でも osm_id を読む", () => {
    const rows = parseExistingList([
      {
        osm_id: "42",
        source: "osm",
        name: null,
        lat: 35.1,
        lng: 139.2,
        has_washlet: null,
        has_paper: false,
        has_soap: null,
        has_diaper_table: null,
        is_universal: null,
        inferred_access: null,
        opening_hours: null,
        protected: [],
      },
    ]);
    expect(rows[0]?.osmId).toBe(42);
    expect(rows[0]?.hasPaper).toBe(false);
  });
});

describe("executeOsmSync", () => {
  it("ロック中は Overpass も apply も呼ばない", async () => {
    const { db, calls } = fakeDb({ acquired: false });
    let fetched = 0;
    const result = await executeOsmSync(db, {
      fetchToilets: async () => {
        fetched += 1;
        return [];
      },
    });
    expect(result).toEqual({ httpStatus: 200, body: { ok: true, skipped: "locked" } });
    expect(fetched).toBe(0);
    expect(calls.map((call) => call.fn)).toEqual(["osm_sync_claim"]);
  });

  it("関数が未作成なら schema を返し、秘密や SQL を載せない", async () => {
    const { db } = fakeDb({
      claimError: { message: "Could not find the function public.osm_sync_claim", code: "PGRST202" },
    });
    const result = await executeOsmSync(db, { fetchToilets: async () => [] });
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ ok: false, skipped: "schema" });
    expect(JSON.stringify(result.body)).not.toMatch(/osm_sync_claim|PGRST|select /i);
  });

  it("user 行を apply から外し、終了時にカーソルと件数を残す", async () => {
    const { db, calls } = fakeDb({
      existing: [
        {
          osm_id: 7,
          source: "user",
          name: "投稿",
          lat: 35.68,
          lng: 139.76,
          has_washlet: true,
          has_paper: null,
          has_soap: null,
          has_diaper_table: null,
          is_universal: null,
          inferred_access: "ask",
          opening_hours: null,
          protected: ["has_washlet"],
        },
      ],
    });
    let clock = 0;
    const result = await executeOsmSync(db, {
      fetchToilets: async () => {
        clock += 40_000;
        return [node(7), node(8)];
      },
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });

    const apply = calls.find((call) => call.fn === "osm_sync_apply");
    const ops = apply?.args.p_ops as { osm_id: number; op: string }[];
    expect(ops.map((op) => op.osm_id)).toEqual([8]);
    expect(ops.some((op) => op.op === "delete")).toBe(false);

    const finish = calls.find((call) => call.fn === "osm_sync_finish");
    expect(finish?.args.p_status).toBe("ok");
    expect(finish?.args.p_counts).toMatchObject({ skipped_user: 1, inserted: 1 });
    expect(result.body.ok).toBe(true);
    expect(result.body.cursor?.prefectureCode).toBe("JP-02");
    expect(JSON.stringify(result.body)).not.toContain("投稿");
  });
});
