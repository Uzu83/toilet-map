import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabaseSecret } from "@/lib/supabase/server";
import { cronAuthorized } from "@/lib/osmSync/auth";
import { rpcClientFromSupabase } from "@/lib/osmSync/db";
import { executeOsmSync } from "@/lib/osmSync/execute";
import { sanitizeSyncError } from "@/lib/osmSync/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// OSM_SYNC_MAX_DURATION_SEC と同じ。Hobby の上限 60 秒。数値は Next が静的に読む。
export const maxDuration = 60;

// Vercel Cron（vercel.json の crons）は GET。Schedules 移行で POST になっても同じ認可で動く。
async function handle(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await executeOsmSync(rpcClientFromSupabase(getServerSupabaseSecret()));
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (err) {
    console.error("[osm-sync]", sanitizeSyncError(err));
    return NextResponse.json({ ok: false, error: "osm_sync_failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
