import type { OsmToiletNode } from "@/lib/osm";
import { backoffDelayMs, isOverpassTimeout } from "@/lib/osmSync/backoff";
import {
  OSM_SYNC_ATTEMPT_TIMEOUT_MS,
  OSM_SYNC_BUDGET_MS,
  OSM_SYNC_GAP_MS,
  OSM_SYNC_MAX_ATTEMPTS,
  OSM_SYNC_MAX_QUERIES,
  OSM_SYNC_OVERPASS_TIMEOUT_SEC,
} from "@/lib/osmSync/config";
import {
  applyOutcome,
  cursorPrefecture,
  type BBox,
  type OsmSyncCursor,
} from "@/lib/osmSync/cursor";
import { planOsmSync, type ExistingToilet, type OsmSyncOp, type OsmSyncPlan } from "@/lib/osmSync/policy";
import { sanitizeSyncError } from "@/lib/osmSync/sanitize";

export type SyncRunStatus = "ok" | "partial" | "error";

export type ApplyCounts = {
  inserted: number;
  updated: number;
  skippedUser: number;
  skippedProtected: number;
  unchanged: number;
  skippedInvalid: number;
};

export type ChunkResult = {
  cursor: OsmSyncCursor;
  status: SyncRunStatus;
  queries: number;
  fetched: number;
  inserted: number;
  updated: number;
  skippedUser: number;
  skippedProtected: number;
  unchanged: number;
  skippedInvalid: number;
  skippedUnits: number;
  prefectureCodes: string[];
  error: string | null;
};

export type RunOsmSyncDeps = {
  cursor: OsmSyncCursor;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  budgetMs?: number;
  maxQueries?: number;
  maxAttempts?: number;
  attemptTimeoutMs?: number;
  overpassTimeoutSec?: number;
  gapMs?: number;
  fetchToilets: (input: {
    code: string;
    bbox: BBox | null;
    timeoutSec: number;
    timeoutMs: number;
  }) => Promise<OsmToiletNode[]>;
  lookup: (osmIds: number[]) => Promise<ExistingToilet[]>;
  apply: (ops: OsmSyncOp[]) => Promise<ApplyCounts>;
};

const ZERO_APPLY: ApplyCounts = {
  inserted: 0,
  updated: 0,
  skippedUser: 0,
  skippedProtected: 0,
  unchanged: 0,
  skippedInvalid: 0,
};

// 1 回の起動で最大 maxQueries 件の Overpass クエリを処理し、予算を超える前に戻る。
// 成功した県（またはタイル）だけカーソルを進める。失敗はバックオフ後に同じ単位を再試行する。
export async function runOsmSyncChunk(deps: RunOsmSyncDeps): Promise<ChunkResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const budgetMs = deps.budgetMs ?? OSM_SYNC_BUDGET_MS;
  const maxQueries = deps.maxQueries ?? OSM_SYNC_MAX_QUERIES;
  const maxAttempts = deps.maxAttempts ?? OSM_SYNC_MAX_ATTEMPTS;
  const attemptTimeoutMs = deps.attemptTimeoutMs ?? OSM_SYNC_ATTEMPT_TIMEOUT_MS;
  const overpassTimeoutSec = deps.overpassTimeoutSec ?? OSM_SYNC_OVERPASS_TIMEOUT_SEC;
  const gapMs = deps.gapMs ?? OSM_SYNC_GAP_MS;

  let cursor = deps.cursor;
  const started = now();
  let queries = 0;
  let fetched = 0;
  let skippedUnits = 0;
  let anySuccess = false;
  let lastError: string | null = null;
  const counts = { ...ZERO_APPLY };
  const prefectureCodes: string[] = [];

  const remain = () => budgetMs - (now() - started);

  while (queries < maxQueries) {
    if (remain() < attemptTimeoutMs + 1_000) break;

    const prefecture = cursorPrefecture(cursor);
    const tile = cursor.tiles?.[0] ?? null;
    let attempt = 0;
    let nodes: OsmToiletNode[] | null = null;
    let timedOut = false;
    let attemptError: string | null = null;

    while (attempt < maxAttempts) {
      const delay = backoffDelayMs(attempt);
      if (remain() < delay + attemptTimeoutMs) break;
      if (delay > 0) await sleep(delay);
      try {
        nodes = await deps.fetchToilets({
          code: prefecture.code,
          bbox: tile?.bbox ?? null,
          timeoutSec: overpassTimeoutSec,
          timeoutMs: attemptTimeoutMs,
        });
        attemptError = null;
        break;
      } catch (err) {
        attemptError = sanitizeSyncError(err);
        timedOut = isOverpassTimeout(attemptError);
        attempt += 1;
        nodes = null;
      }
    }

    if (!nodes) {
      // 1 回も試せないまま予算が尽きた場合は失敗として数えない（次回そのまま再開）。
      if (!attemptError) break;
      lastError = attemptError;
      queries += 1;
      const outcome = applyOutcome(cursor, { type: timedOut ? "timeout" : "failure" });
      cursor = outcome.cursor;
      if (outcome.skippedUnit) skippedUnits += 1;
      if (outcome.split && queries < maxQueries && remain() >= attemptTimeoutMs + 1_000) {
        continue;
      }
      break;
    }

    queries += 1;
    fetched += nodes.length;
    if (!prefectureCodes.includes(prefecture.code)) prefectureCodes.push(prefecture.code);

    try {
      const ids = uniqueOsmIds(nodes);
      const existing = ids.length > 0 ? await deps.lookup(ids) : [];
      const plan = planOsmSync(nodes, existing);
      addPlan(counts, plan);
      if (plan.ops.length > 0) {
        const applied = await deps.apply(plan.ops);
        addApply(counts, applied);
      }
    } catch (err) {
      lastError = sanitizeSyncError(err);
      const outcome = applyOutcome(cursor, { type: "failure" });
      cursor = outcome.cursor;
      if (outcome.skippedUnit) skippedUnits += 1;
      break;
    }

    anySuccess = true;
    cursor = applyOutcome(cursor, { type: "success" }).cursor;

    if (queries < maxQueries && remain() > gapMs + attemptTimeoutMs) {
      await sleep(gapMs);
    }
  }

  let status: SyncRunStatus;
  if (lastError && anySuccess) status = "partial";
  else if (lastError) status = "error";
  else status = "ok";

  return {
    cursor,
    status,
    queries,
    fetched,
    inserted: counts.inserted,
    updated: counts.updated,
    skippedUser: counts.skippedUser,
    skippedProtected: counts.skippedProtected,
    unchanged: counts.unchanged,
    skippedInvalid: counts.skippedInvalid,
    skippedUnits,
    prefectureCodes,
    error: lastError,
  };
}

function uniqueOsmIds(nodes: OsmToiletNode[]): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const node of nodes) {
    if (!Number.isSafeInteger(node.osmId) || node.osmId <= 0 || seen.has(node.osmId)) continue;
    seen.add(node.osmId);
    ids.push(node.osmId);
  }
  return ids;
}

function addPlan(counts: ApplyCounts, plan: OsmSyncPlan) {
  counts.skippedUser += plan.skippedUser;
  counts.skippedProtected += plan.skippedProtected;
  counts.unchanged += plan.unchanged;
  counts.skippedInvalid += plan.skippedInvalid;
}

function addApply(counts: ApplyCounts, applied: ApplyCounts) {
  counts.inserted += applied.inserted;
  counts.updated += applied.updated;
  counts.skippedUser += applied.skippedUser;
  counts.skippedProtected += applied.skippedProtected;
  counts.unchanged += applied.unchanged;
  counts.skippedInvalid += applied.skippedInvalid;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
