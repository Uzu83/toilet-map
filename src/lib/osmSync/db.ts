import type { SupabaseClient } from "@supabase/supabase-js";
import { OSM_SYNC_APPLY_CHUNK, OSM_SYNC_LOOKUP_CHUNK } from "@/lib/osmSync/config";
import { chunkOps, type ExistingToilet, type OsmSyncOp } from "@/lib/osmSync/policy";
import type { ApplyCounts } from "@/lib/osmSync/run";

export type RpcError = { message: string; code?: string };

export type OsmSyncDb = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: RpcError | null }>;
};

export function rpcClientFromSupabase(supabase: SupabaseClient): OsmSyncDb {
  return {
    rpc: async (fn, args) => {
      const { data, error } = await supabase.rpc(fn, args);
      return {
        data,
        error: error ? { message: error.message, code: error.code } : null,
      };
    },
  };
}

export function isMissingOsmSyncSchema(error: RpcError | null): boolean {
  if (!error) return false;
  return /osm_sync_|PGRST202|schema cache|does not exist|42P01/i.test(
    `${error.code ?? ""} ${error.message}`,
  );
}

export type ClaimResult =
  | { acquired: false }
  | { acquired: true; cursor: unknown; runId: string };

export async function claimSync(db: OsmSyncDb, leaseSeconds: number): Promise<ClaimResult> {
  const { data, error } = await db.rpc("osm_sync_claim", { p_lease_seconds: leaseSeconds });
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("osm_sync_claim returned no data");
  const row = data as Record<string, unknown>;
  if (row.acquired !== true) return { acquired: false };
  if (typeof row.run_id !== "string") throw new Error("osm_sync_claim returned no run id");
  return { acquired: true, cursor: row.cursor, runId: row.run_id };
}

export async function lookupExisting(db: OsmSyncDb, osmIds: number[]): Promise<ExistingToilet[]> {
  const rows: ExistingToilet[] = [];
  for (let i = 0; i < osmIds.length; i += OSM_SYNC_LOOKUP_CHUNK) {
    const slice = osmIds.slice(i, i + OSM_SYNC_LOOKUP_CHUNK);
    const { data, error } = await db.rpc("osm_sync_lookup", { p_osm_ids: slice });
    if (error) throw error;
    rows.push(...parseExistingList(data));
  }
  return rows;
}

export async function applyOps(db: OsmSyncDb, ops: OsmSyncOp[]): Promise<ApplyCounts> {
  const totals: ApplyCounts = {
    inserted: 0,
    updated: 0,
    skippedUser: 0,
    skippedProtected: 0,
    unchanged: 0,
    skippedInvalid: 0,
  };
  for (const part of chunkOps(ops, OSM_SYNC_APPLY_CHUNK)) {
    const { data, error } = await db.rpc("osm_sync_apply", { p_ops: part });
    if (error) throw error;
    const counts = parseApplyCounts(data);
    totals.inserted += counts.inserted;
    totals.updated += counts.updated;
    totals.skippedUser += counts.skippedUser;
    totals.skippedProtected += counts.skippedProtected;
    totals.unchanged += counts.unchanged;
    totals.skippedInvalid += counts.skippedInvalid;
  }
  return totals;
}

export async function finishSync(
  db: OsmSyncDb,
  input: {
    runId: string;
    cursor: unknown;
    status: "ok" | "partial" | "error";
    counts: Record<string, number>;
    prefectureCodes: string[];
    error: string | null;
    note: string | null;
  },
): Promise<void> {
  const { error } = await db.rpc("osm_sync_finish", {
    p_run_id: input.runId,
    p_cursor: input.cursor,
    p_status: input.status,
    p_counts: input.counts,
    p_prefecture_codes: input.prefectureCodes,
    p_error: input.error,
    p_note: input.note,
  });
  if (error) throw error;
}

export function parseExistingList(data: unknown): ExistingToilet[] {
  if (!Array.isArray(data)) throw new Error("osm_sync_lookup returned a non-array");
  return data.map(parseExisting);
}

function parseOsmId(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  // PostgREST が bigint を文字列で返す設定でも、安全な整数なら受け取る。
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  throw new Error("osm_sync_lookup row has a bad osm_id");
}

function parseExisting(value: unknown): ExistingToilet {
  if (!value || typeof value !== "object") throw new Error("osm_sync_lookup row is not an object");
  const row = value as Record<string, unknown>;
  const osmId = parseOsmId(row.osm_id);
  if (typeof row.source !== "string") throw new Error("osm_sync_lookup row has a bad source");
  const lat = row.lat;
  const lng = row.lng;
  if (typeof lat !== "number" || typeof lng !== "number") {
    throw new Error("osm_sync_lookup row has a bad location");
  }
  if (!Array.isArray(row.protected) || row.protected.some((field) => typeof field !== "string")) {
    throw new Error("osm_sync_lookup row has a bad protected list");
  }
  return {
    osmId,
    source: row.source,
    name: optionalText(row.name),
    lat,
    lng,
    hasWashlet: optionalBool(row.has_washlet),
    hasPaper: optionalBool(row.has_paper),
    hasSoap: optionalBool(row.has_soap),
    hasDiaperTable: optionalBool(row.has_diaper_table),
    isUniversal: optionalBool(row.is_universal),
    inferredAccess: optionalAccess(row.inferred_access),
    openingHours: optionalText(row.opening_hours),
    protected: row.protected,
  };
}

export function parseApplyCounts(data: unknown): ApplyCounts {
  if (!data || typeof data !== "object") throw new Error("osm_sync_apply returned no counts");
  const row = data as Record<string, unknown>;
  return {
    inserted: countField(row, "inserted"),
    updated: countField(row, "updated"),
    skippedUser: countField(row, "skipped_user"),
    skippedProtected: countField(row, "skipped_protected"),
    unchanged: countField(row, "unchanged"),
    skippedInvalid: countField(row, "skipped_invalid"),
  };
}

function countField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("osm_sync_apply returned a bad count");
  }
  return value;
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("osm_sync_lookup row has a bad text field");
  return value;
}

function optionalBool(value: unknown): boolean | null {
  if (value == null) return null;
  if (typeof value !== "boolean") throw new Error("osm_sync_lookup row has a bad boolean field");
  return value;
}

function optionalAccess(value: unknown): "open" | "ask" | "permission" | null {
  if (value == null) return null;
  if (value === "open" || value === "ask" || value === "permission") return value;
  throw new Error("osm_sync_lookup row has a bad inferred_access");
}
