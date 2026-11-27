import { JP_PREFECTURES, type Prefecture } from "@/lib/regions";
import { OSM_SYNC_MAX_CONSECUTIVE_FAILURES, OSM_SYNC_MAX_TILE_DEPTH } from "@/lib/osmSync/config";

// bbox = [south, west, north, east]。regions.ts と同じ並び。
export type BBox = [number, number, number, number];

export type SyncTile = {
  bbox: BBox;
  depth: number;
};

// 再開点。都道府県を一周し、大きい県は bbox を割って次回に持ち越す。
// 個人情報も秘密も持たない。
export type OsmSyncCursor = {
  v: 1;
  prefectureIndex: number;
  tiles: SyncTile[] | null;
  consecutiveFailures: number;
};

export const INITIAL_CURSOR: OsmSyncCursor = {
  v: 1,
  prefectureIndex: 0,
  tiles: null,
  consecutiveFailures: 0,
};

export type UnitOutcome = { type: "success" } | { type: "timeout" } | { type: "failure" };

export type OutcomeResult = {
  cursor: OsmSyncCursor;
  skippedUnit: boolean;
  split: boolean;
};

export function cursorPrefecture(cursor: OsmSyncCursor): Prefecture {
  const len = JP_PREFECTURES.length;
  const index = ((cursor.prefectureIndex % len) + len) % len;
  return JP_PREFECTURES[index]!;
}

export function serializeCursor(cursor: OsmSyncCursor): OsmSyncCursor {
  return {
    v: 1,
    prefectureIndex: cursor.prefectureIndex,
    tiles: cursor.tiles,
    consecutiveFailures: cursor.consecutiveFailures,
  };
}

export function parseCursor(value: unknown): { cursor: OsmSyncCursor; reset: boolean } {
  if (!value || typeof value !== "object") return { cursor: INITIAL_CURSOR, reset: true };
  const raw = value as Record<string, unknown>;
  if (raw.v !== 1) return { cursor: INITIAL_CURSOR, reset: true };
  const index = raw.prefectureIndex;
  const failures = raw.consecutiveFailures;
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= JP_PREFECTURES.length) {
    return { cursor: INITIAL_CURSOR, reset: true };
  }
  if (!Number.isInteger(failures) || (failures as number) < 0 || (failures as number) > 100) {
    return { cursor: INITIAL_CURSOR, reset: true };
  }
  if (raw.tiles === null) {
    return {
      cursor: {
        v: 1,
        prefectureIndex: index as number,
        tiles: null,
        consecutiveFailures: failures as number,
      },
      reset: false,
    };
  }
  if (!Array.isArray(raw.tiles)) return { cursor: INITIAL_CURSOR, reset: true };
  const tiles: SyncTile[] = [];
  for (const tile of raw.tiles) {
    if (!tile || typeof tile !== "object") return { cursor: INITIAL_CURSOR, reset: true };
    const record = tile as Record<string, unknown>;
    if (!Number.isInteger(record.depth) || (record.depth as number) < 1 || (record.depth as number) > 10) {
      return { cursor: INITIAL_CURSOR, reset: true };
    }
    if (!isBBox(record.bbox)) return { cursor: INITIAL_CURSOR, reset: true };
    tiles.push({ bbox: record.bbox, depth: record.depth as number });
  }
  return {
    cursor: {
      v: 1,
      prefectureIndex: index as number,
      tiles,
      consecutiveFailures: failures as number,
    },
    reset: false,
  };
}

// 県の全体クエリが時間切れなら 4 分割、タイルが時間切れならそのタイルだけ掘る。
// 深さ上限か連続失敗の上限に達した単位は飛ばして、全国の回転を止めない。
export function applyOutcome(cursor: OsmSyncCursor, outcome: UnitOutcome): OutcomeResult {
  if (outcome.type === "success") {
    return { cursor: advancePastCurrent(cursor), skippedUnit: false, split: false };
  }

  if (outcome.type === "timeout") {
    const current = cursor.tiles?.[0];
    const depth = current?.depth ?? 0;
    const bbox = current?.bbox ?? cursorPrefecture(cursor).bbox;
    if (depth < OSM_SYNC_MAX_TILE_DEPTH) {
      const children = splitBBox(bbox);
      if (children) {
        const rest = cursor.tiles?.slice(1) ?? [];
        const childTiles = children.map((child) => ({ bbox: child, depth: depth + 1 }));
        return {
          cursor: {
            ...cursor,
            tiles: [...childTiles, ...rest],
            consecutiveFailures: 0,
          },
          skippedUnit: false,
          split: true,
        };
      }
    }
    return { cursor: advancePastCurrent(cursor), skippedUnit: true, split: false };
  }

  const failures = cursor.consecutiveFailures + 1;
  if (failures >= OSM_SYNC_MAX_CONSECUTIVE_FAILURES) {
    return { cursor: advancePastCurrent(cursor), skippedUnit: true, split: false };
  }
  return {
    cursor: { ...cursor, consecutiveFailures: failures },
    skippedUnit: false,
    split: false,
  };
}

export function splitBBox(bbox: BBox): BBox[] | null {
  const [south, west, north, east] = bbox;
  if (!(north - south > 0.02) || !(east - west > 0.02)) return null;
  const midLat = (south + north) / 2;
  const midLng = (west + east) / 2;
  return [
    [south, west, midLat, midLng],
    [south, midLng, midLat, east],
    [midLat, west, north, midLng],
    [midLat, midLng, north, east],
  ];
}

function advancePastCurrent(cursor: OsmSyncCursor): OsmSyncCursor {
  const rest = cursor.tiles?.slice(1) ?? [];
  if (cursor.tiles && cursor.tiles.length > 0 && rest.length > 0) {
    return { ...cursor, tiles: rest, consecutiveFailures: 0 };
  }
  return {
    v: 1,
    prefectureIndex: (cursor.prefectureIndex + 1) % JP_PREFECTURES.length,
    tiles: null,
    consecutiveFailures: 0,
  };
}

function isBBox(value: unknown): value is BBox {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [south, west, north, east] = value;
  if (![south, west, north, east].every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  return south >= -90 && north <= 90 && south < north && west >= -180 && east <= 180 && west < east;
}
