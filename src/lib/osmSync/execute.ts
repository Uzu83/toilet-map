import { fetchToiletsInPrefecture } from "@/lib/osm";
import { OSM_SYNC_LEASE_SECONDS } from "@/lib/osmSync/config";
import {
  cursorPrefecture,
  parseCursor,
  serializeCursor,
  type OsmSyncCursor,
} from "@/lib/osmSync/cursor";
import {
  applyOps,
  claimSync,
  finishSync,
  isMissingOsmSyncSchema,
  lookupExisting,
  type OsmSyncDb,
  type RpcError,
} from "@/lib/osmSync/db";
import { runOsmSyncChunk, type ChunkResult, type RunOsmSyncDeps } from "@/lib/osmSync/run";
import { sanitizeSyncError } from "@/lib/osmSync/sanitize";

export type OsmSyncBody = {
  ok: boolean;
  skipped?: "locked" | "schema";
  status?: ChunkResult["status"];
  queries?: number;
  fetched?: number;
  inserted?: number;
  updated?: number;
  skippedUser?: number;
  skippedProtected?: number;
  unchanged?: number;
  skippedInvalid?: number;
  skippedUnits?: number;
  prefectures?: string[];
  cursor?: {
    prefectureIndex: number;
    prefectureCode: string;
    tilesRemaining: number;
    consecutiveFailures: number;
  };
  error?: string;
};

export type OsmSyncExecution = {
  httpStatus: number;
  body: OsmSyncBody;
};

type FetchDeps = Pick<RunOsmSyncDeps, "fetchToilets" | "now" | "sleep">;

// Cron ルートと `pnpm osm-sync` の共通入口。Overpass 取得は seed と同じ
// fetchToiletsInPrefecture を使い、書き込みは osm_sync_apply だけに通す。
export async function executeOsmSync(
  db: OsmSyncDb,
  deps: Partial<FetchDeps> = {},
): Promise<OsmSyncExecution> {
  let runId: string | null = null;
  let cursor: OsmSyncCursor | null = null;
  let note: string | null = null;

  try {
    const claim = await claimSync(db, OSM_SYNC_LEASE_SECONDS);
    if (!claim.acquired) {
      return { httpStatus: 200, body: { ok: true, skipped: "locked" } };
    }
    runId = claim.runId;
    const parsed = parseCursor(claim.cursor);
    cursor = parsed.cursor;
    if (parsed.reset) note = "cursor reset";

    const result = await runOsmSyncChunk({
      cursor,
      now: deps.now,
      sleep: deps.sleep,
      fetchToilets:
        deps.fetchToilets ??
        (async ({ code, bbox, timeoutSec, timeoutMs }) => {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), timeoutMs);
          try {
            return await fetchToiletsInPrefecture(code, {
              timeoutSec,
              bbox: bbox ?? undefined,
              signal: ac.signal,
            });
          } finally {
            clearTimeout(timer);
          }
        }),
      lookup: (osmIds) => lookupExisting(db, osmIds),
      apply: (ops) => applyOps(db, ops),
    });
    cursor = result.cursor;

    await finishSync(db, {
      runId,
      cursor: serializeCursor(result.cursor),
      status: result.status,
      counts: countsOf(result),
      prefectureCodes: result.prefectureCodes,
      error: result.error,
      note,
    });

    return {
      httpStatus: 200,
      body: bodyFromResult(result, result.status === "ok" || result.status === "partial"),
    };
  } catch (err) {
    const rpcError = asRpcError(err);
    if (isMissingOsmSyncSchema(rpcError)) {
      console.error("[osm-sync] schema unavailable");
      return { httpStatus: 200, body: { ok: false, skipped: "schema" } };
    }
    const message = sanitizeSyncError(err);
    console.error("[osm-sync]", message);
    if (runId && cursor) {
      try {
        await finishSync(db, {
          runId,
          cursor: serializeCursor(cursor),
          status: "error",
          counts: {},
          prefectureCodes: [],
          error: message,
          note,
        });
      } catch (finishErr) {
        console.error("[osm-sync] finish failed", sanitizeSyncError(finishErr));
      }
    }
    return { httpStatus: 200, body: { ok: false, status: "error", error: message } };
  }
}

function bodyFromResult(result: ChunkResult, ok: boolean): OsmSyncBody {
  const prefecture = cursorPrefecture(result.cursor);
  return {
    ok,
    status: result.status,
    queries: result.queries,
    fetched: result.fetched,
    inserted: result.inserted,
    updated: result.updated,
    skippedUser: result.skippedUser,
    skippedProtected: result.skippedProtected,
    unchanged: result.unchanged,
    skippedInvalid: result.skippedInvalid,
    skippedUnits: result.skippedUnits,
    prefectures: result.prefectureCodes,
    cursor: {
      prefectureIndex: result.cursor.prefectureIndex,
      prefectureCode: prefecture.code,
      tilesRemaining: result.cursor.tiles?.length ?? 0,
      consecutiveFailures: result.cursor.consecutiveFailures,
    },
    ...(result.error ? { error: result.error } : {}),
  };
}

function countsOf(result: ChunkResult): Record<string, number> {
  return {
    queries: result.queries,
    fetched: result.fetched,
    inserted: result.inserted,
    updated: result.updated,
    skipped_user: result.skippedUser,
    skipped_protected: result.skippedProtected,
    unchanged: result.unchanged,
    skipped_invalid: result.skippedInvalid,
    skipped_units: result.skippedUnits,
  };
}

function asRpcError(err: unknown): RpcError | null {
  if (!err || typeof err !== "object") return null;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  const code = (err as { code?: unknown }).code;
  return { message, code: typeof code === "string" ? code : undefined };
}
