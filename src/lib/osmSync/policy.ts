import type { OsmToiletNode } from "@/lib/osm";
import {
  OSM_SYNC_LOCATION_EPS,
  OSM_SYNC_MAX_HOURS_LEN,
  OSM_SYNC_MAX_NAME_LEN,
} from "@/lib/osmSync/config";

// OSM 同期が書いてよい列。source は insert 時だけ。location は lat/lng で別扱い。
// admin_edits.changed_fields にこれらの名前（または "location"）があれば、その列は上書きしない。
export const OSM_SYNC_MUTABLE_FIELDS = [
  "name",
  "has_washlet",
  "has_paper",
  "has_soap",
  "has_diaper_table",
  "is_universal",
  "inferred_access",
  "opening_hours",
] as const;

export type OsmSyncMutableField = (typeof OSM_SYNC_MUTABLE_FIELDS)[number];

export type ExistingToilet = {
  osmId: number;
  source: string;
  name: string | null;
  lat: number;
  lng: number;
  hasWashlet: boolean | null;
  hasPaper: boolean | null;
  hasSoap: boolean | null;
  hasDiaperTable: boolean | null;
  isUniversal: boolean | null;
  inferredAccess: "open" | "ask" | "permission" | null;
  openingHours: string | null;
  protected: string[];
};

// insert は OSM に値が無い列を null のまま入れてよい（新規行には既存値が無い）。
export type OsmSyncInsert = {
  op: "insert";
  osm_id: number;
  name: string | null;
  lng: number;
  lat: number;
  has_washlet: boolean | null;
  has_paper: boolean | null;
  has_soap: boolean | null;
  has_diaper_table: boolean | null;
  is_universal: boolean | null;
  source: "osm" | "inferred";
  inferred_access: "open" | "ask" | "permission" | null;
  opening_hours: string | null;
};

// update の set に null は入れない。キーが無い = 既存値を残す。source は入れない。
export type OsmSyncUpdate = {
  op: "update";
  osm_id: number;
  set: Partial<{
    name: string;
    lng: number;
    lat: number;
    has_washlet: boolean;
    has_paper: boolean;
    has_soap: boolean;
    has_diaper_table: boolean;
    is_universal: boolean;
    inferred_access: "open" | "ask" | "permission";
    opening_hours: string;
  }>;
};

export type OsmSyncOp = OsmSyncInsert | OsmSyncUpdate;

export type OsmSyncPlan = {
  ops: OsmSyncOp[];
  skippedUser: number;
  skippedProtected: number;
  unchanged: number;
  skippedInvalid: number;
};

// データ保護の仕様（SQL の osm_sync_apply も同じ規則を再チェックする）:
// 1. 衝突キーは osm_id。無ければ insert、あれば update。
// 2. source='user' の行は一切触らない（insert にも update にもしない）。
// 3. OSM 側が null（タグなし）の列は、既存値を null で上書きしない。
// 4. admin_edits.changed_fields に入った列は、editor が admin でも ai でも上書きしない。
// 5. source は insert 時だけ osm / inferred。update では変えない。
// 6. delete はしない。この型に delete は無い。
export function planOsmSync(incoming: OsmToiletNode[], existing: ExistingToilet[]): OsmSyncPlan {
  const byId = new Map<number, ExistingToilet>();
  for (const row of existing) byId.set(row.osmId, row);

  const ops: OsmSyncOp[] = [];
  const seen = new Set<number>();
  let skippedUser = 0;
  let skippedProtected = 0;
  let unchanged = 0;
  let skippedInvalid = 0;

  for (const node of incoming) {
    if (!Number.isSafeInteger(node.osmId) || node.osmId <= 0) {
      skippedInvalid++;
      continue;
    }
    if (seen.has(node.osmId)) continue;
    seen.add(node.osmId);
    if (!validCoord(node.lat, node.lng)) {
      skippedInvalid++;
      continue;
    }
    if (node.source !== "osm" && node.source !== "inferred") {
      skippedInvalid++;
      continue;
    }

    const current = byId.get(node.osmId);
    if (!current) {
      ops.push(toInsert(node));
      continue;
    }
    if (current.source === "user") {
      skippedUser++;
      continue;
    }

    const protectedFields = new Set(current.protected);
    const set: OsmSyncUpdate["set"] = {};
    const keep = <K extends keyof OsmSyncUpdate["set"]>(
      field: string,
      key: K,
      incomingValue: OsmSyncUpdate["set"][K] | null,
      currentValue: OsmSyncUpdate["set"][K] | null,
    ) => {
      if (incomingValue == null) return;
      if (protectedFields.has(field)) {
        skippedProtected++;
        return;
      }
      if (incomingValue !== currentValue) {
        set[key] = incomingValue;
      }
    };

    keep("name", "name", usableText(node.name, OSM_SYNC_MAX_NAME_LEN), current.name);
    keep("has_washlet", "has_washlet", node.hasWashlet, current.hasWashlet);
    keep("has_paper", "has_paper", node.hasPaper, current.hasPaper);
    keep("has_soap", "has_soap", node.hasSoap, current.hasSoap);
    keep("has_diaper_table", "has_diaper_table", node.hasDiaperTable, current.hasDiaperTable);
    keep("is_universal", "is_universal", node.isUniversal, current.isUniversal);
    keep("inferred_access", "inferred_access", node.inferredAccess, current.inferredAccess);
    keep(
      "opening_hours",
      "opening_hours",
      usableText(node.openingHours, OSM_SYNC_MAX_HOURS_LEN),
      current.openingHours,
    );

    const moved =
      Math.abs(node.lat - current.lat) > OSM_SYNC_LOCATION_EPS ||
      Math.abs(node.lng - current.lng) > OSM_SYNC_LOCATION_EPS;
    if (moved) {
      if (protectedFields.has("location")) {
        skippedProtected++;
      } else {
        set.lat = node.lat;
        set.lng = node.lng;
      }
    }

    if (Object.keys(set).length === 0) {
      unchanged++;
      continue;
    }
    ops.push({ op: "update", osm_id: node.osmId, set });
  }

  return { ops, skippedUser, skippedProtected, unchanged, skippedInvalid };
}

export function chunkOps(ops: OsmSyncOp[], size: number): OsmSyncOp[][] {
  const chunkSize = Math.max(1, Math.floor(size));
  const out: OsmSyncOp[][] = [];
  for (let i = 0; i < ops.length; i += chunkSize) {
    out.push(ops.slice(i, i + chunkSize));
  }
  return out;
}

function toInsert(node: OsmToiletNode): OsmSyncInsert {
  return {
    op: "insert",
    osm_id: node.osmId,
    name: usableText(node.name, OSM_SYNC_MAX_NAME_LEN),
    lng: node.lng,
    lat: node.lat,
    has_washlet: node.hasWashlet,
    has_paper: node.hasPaper,
    has_soap: node.hasSoap,
    has_diaper_table: node.hasDiaperTable,
    is_universal: node.isUniversal,
    source: node.source,
    inferred_access: node.inferredAccess,
    opening_hours: usableText(node.openingHours, OSM_SYNC_MAX_HOURS_LEN),
  };
}

function usableText(value: string | null, maxLen: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

function validCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
