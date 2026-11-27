import { describe, expect, it } from "vitest";
import type { OsmToiletNode } from "@/lib/osm";
import { chunkOps, planOsmSync, type ExistingToilet, type OsmSyncOp } from "@/lib/osmSync/policy";

function node(overrides: Partial<OsmToiletNode> = {}): OsmToiletNode {
  return {
    osmId: 100,
    lat: 33.59,
    lng: 130.4,
    name: "駅前トイレ",
    hasWashlet: true,
    hasPaper: false,
    hasSoap: null,
    hasDiaperTable: null,
    isUniversal: true,
    openingHours: "24/7",
    source: "osm",
    inferredAccess: null,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingToilet> = {}): ExistingToilet {
  return {
    osmId: 100,
    source: "osm",
    name: "旧名",
    lat: 33.59,
    lng: 130.4,
    hasWashlet: true,
    hasPaper: true,
    hasSoap: true,
    hasDiaperTable: true,
    isUniversal: false,
    inferredAccess: "open",
    openingHours: "Mo-Fr 09:00-17:00",
    protected: [],
    ...overrides,
  };
}

function assertSafe(op: OsmSyncOp) {
  expect(op.op === "insert" || op.op === "update").toBe(true);
  if (op.op === "update") {
    expect(op.set).not.toHaveProperty("source");
    expect(Object.values(op.set)).not.toContain(null);
  }
}

describe("planOsmSync", () => {
  it("新規は osm_id で insert し、タグの無い列は null のまま入れる", () => {
    const plan = planOsmSync([node({ hasSoap: null, hasDiaperTable: null })], []);
    expect(plan.ops).toEqual([
      expect.objectContaining({
        op: "insert",
        osm_id: 100,
        source: "osm",
        has_washlet: true,
        has_soap: null,
        has_diaper_table: null,
      }),
    ]);
    expect(plan.ops.every((op) => op.op !== "update")).toBe(true);
  });

  it("source=user の行は insert も update もしない", () => {
    const plan = planOsmSync(
      [node({ name: "OSM が上書きしようとする", hasWashlet: false })],
      [existing({ source: "user", name: "利用者投稿", hasWashlet: true })],
    );
    expect(plan.ops).toEqual([]);
    expect(plan.skippedUser).toBe(1);
  });

  it("OSM が null の列は既存値を上書きしない", () => {
    const plan = planOsmSync(
      [
        node({
          hasWashlet: null,
          hasPaper: null,
          hasSoap: null,
          hasDiaperTable: null,
          isUniversal: null,
          openingHours: null,
          name: null,
        }),
      ],
      [existing({ hasWashlet: true, hasPaper: true, hasSoap: false, name: "残す名前" })],
    );
    expect(plan.ops).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("false は値なので、保護されていない boolean は上書きする", () => {
    const plan = planOsmSync(
      [
        node({
          name: "旧名",
          hasWashlet: true,
          hasPaper: false,
          isUniversal: false,
          openingHours: "Mo-Fr 09:00-17:00",
        }),
      ],
      [existing({ hasPaper: true, isUniversal: true, protected: [] })],
    );
    expect(plan.ops).toEqual([
      {
        op: "update",
        osm_id: 100,
        set: { has_paper: false, is_universal: false },
      },
    ]);
  });

  it("admin_edits に入った列は残し、入っていない列は更新する", () => {
    const plan = planOsmSync(
      [
        node({
          name: "OSM の新しい名前",
          hasWashlet: false,
          hasPaper: true,
          isUniversal: false,
          openingHours: "24/7",
        }),
      ],
      [
        existing({
          name: "管理者が直した名前",
          hasWashlet: true,
          openingHours: "Mo-Fr 09:00-17:00",
          protected: ["name", "has_washlet"],
        }),
      ],
    );
    expect(plan.skippedProtected).toBe(2);
    expect(plan.ops).toEqual([
      {
        op: "update",
        osm_id: 100,
        set: { opening_hours: "24/7" },
      },
    ]);
  });

  it("update は source を変えない（inferred の行に osm の値が来ても）", () => {
    const plan = planOsmSync(
      [
        node({
          source: "osm",
          name: "旧名",
          hasWashlet: false,
          hasPaper: true,
          isUniversal: false,
          openingHours: "Mo-Fr 09:00-17:00",
        }),
      ],
      [existing({ source: "inferred", hasWashlet: null })],
    );
    expect(plan.ops).toHaveLength(1);
    const op = plan.ops[0]!;
    expect(op.op).toBe("update");
    if (op.op === "update") {
      expect(op.set).toEqual({ has_washlet: false });
      expect(op.set).not.toHaveProperty("source");
    }
  });

  it("ほぼ同じ座標は location を書き直さない。十分に動いた点だけ書く", () => {
    const still = planOsmSync(
      [node({ lat: 33.5900004, lng: 130.4000004, name: "旧名", hasWashlet: true, hasPaper: true, isUniversal: false, openingHours: "Mo-Fr 09:00-17:00" })],
      [existing()],
    );
    expect(still.ops).toEqual([]);

    const moved = planOsmSync([node({ lat: 33.6, lng: 130.5 })], [existing()]);
    expect(moved.ops[0]).toMatchObject({ op: "update", set: { lat: 33.6, lng: 130.5 } });
  });

  it("location が管理編集なら座標を動かさない", () => {
    const plan = planOsmSync(
      [node({ lat: 34, lng: 131 })],
      [existing({ protected: ["location"] })],
    );
    const op = plan.ops[0];
    if (op?.op === "update") {
      expect(op.set).not.toHaveProperty("lat");
      expect(op.set).not.toHaveProperty("lng");
    }
    expect(plan.skippedProtected).toBeGreaterThan(0);
  });

  it("同じ osm_id が複数あっても 1 件だけ扱う", () => {
    const plan = planOsmSync([node(), node({ name: "2件目" })], []);
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({ op: "insert", name: "駅前トイレ" });
  });

  it("座標が壊れた行と user 以外の不正 source は捨てる", () => {
    const plan = planOsmSync(
      [
        node({ lat: Number.NaN }),
        node({ osmId: 0 }),
        node({ osmId: 303, source: "user" as "osm" }),
      ],
      [],
    );
    expect(plan.ops).toEqual([]);
    expect(plan.skippedInvalid).toBe(3);
  });

  it("長すぎる営業時間は値なしとして、既存の式を壊さない", () => {
    const plan = planOsmSync(
      [node({ openingHours: "x".repeat(501) })],
      [existing({ openingHours: "24/7" })],
    );
    expect(JSON.stringify(plan.ops)).not.toContain("opening_hours");
  });

  it("計画に delete は無く、update は null も source も持たない", () => {
    const plan = planOsmSync(
      [node(), node({ osmId: 200, name: null, hasWashlet: null })],
      [existing({ osmId: 200, name: "残る", hasWashlet: true })],
    );
    for (const op of plan.ops) assertSafe(op);
    expect(JSON.stringify(plan.ops)).not.toContain("delete");
  });
});

describe("chunkOps", () => {
  it("200 件ずつに割り、端数を残す", () => {
    const ops = Array.from({ length: 450 }, (_, i) => ({
      op: "insert" as const,
      osm_id: i + 1,
      name: null,
      lng: 130,
      lat: 33,
      has_washlet: null,
      has_paper: null,
      has_soap: null,
      has_diaper_table: null,
      is_universal: null,
      source: "osm" as const,
      inferred_access: null,
      opening_hours: null,
    }));
    const chunks = chunkOps(ops, 200);
    expect(chunks.map((chunk) => chunk.length)).toEqual([200, 200, 50]);
  });
});
