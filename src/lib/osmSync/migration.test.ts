import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OSM_SYNC_MAX_DURATION_SEC } from "@/lib/osmSync/config";
import { OSM_SYNC_MUTABLE_FIELDS } from "@/lib/osmSync/policy";

const sql = readFileSync("supabase/migrations/019_osm_sync.sql", "utf8");
const route = readFileSync("src/app/api/cron/osm-sync/route.ts", "utf8");
const vercel = readFileSync("vercel.json", "utf8");

describe("019_osm_sync.sql", () => {
  it("toilets を削除せず、user 行と管理編集と null 上書きを拒否する", () => {
    expect(sql).not.toMatch(/delete\s+from\s+toilets/i);
    expect(sql).not.toMatch(/truncate\s+(table\s+)?toilets/i);
    expect(sql).toContain("v_source = 'user'");
    expect(sql).toContain("admin_edits");
    expect(sql).toContain("jsonb_typeof");
    expect(sql).toContain("skipped_user");
    expect(sql).toContain("skipped_protected");
    for (const field of OSM_SYNC_MUTABLE_FIELDS) {
      expect(sql).toContain(`'${field}'`);
    }
    expect(sql).toContain("'location'");
  });

  it("update 文は source を代入しない", () => {
    const start = sql.indexOf("-- OSM_SYNC_UPDATE_BEGIN");
    const end = sql.indexOf("-- OSM_SYNC_UPDATE_END");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const update = sql.slice(start, end);
    expect(update).not.toMatch(/\bsource\b/);
  });

  it("anon には実行させず、search_path を固定する", () => {
    expect(sql).toContain("revoke all on function osm_sync_apply(jsonb) from anon, authenticated");
    expect(sql).toContain("grant execute on function osm_sync_apply(jsonb) to service_role");
    expect(sql).toContain("enable row level security");
    expect(sql.match(/set search_path = public/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).not.toMatch(/CRON_SECRET|sb_secret_/);
  });
});

describe("週次スケジュール", () => {
  it("Vercel Cron が週次で保護ルートを叩き、関数上限は 60 秒", () => {
    const config = JSON.parse(vercel) as { crons: { path: string; schedule: string }[] };
    expect(config.crons).toEqual([{ path: "/api/cron/osm-sync", schedule: "0 18 * * 1" }]);
    expect(route).toContain("export const maxDuration = 60");
    expect(route).toContain("cronAuthorized");
    expect(OSM_SYNC_MAX_DURATION_SEC).toBe(60);
  });
});
