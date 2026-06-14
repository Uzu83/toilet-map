import { NextResponse, type NextRequest } from "next/server";
import {
  getServerSupabasePublishable,
  getServerSupabaseSecret,
} from "@/lib/supabase/server";
import { checkAndRecord, extractIp, hashIp, makeCoordKey } from "@/lib/rateLimit";

export const runtime = "nodejs";

const ACCESS_VALUES = new Set(["open", "ask", "permission"]);

type SubmissionBody = {
  lat?: unknown;
  lng?: unknown;
  accessLevel?: unknown;
  name?: unknown;
  isOutdoor?: unknown;
  isUniversal?: unknown;
  comment?: unknown;
};

// GET /api/submissions?bbox=minLng,minLat,maxLng,maxLat — bbox 内の pending 申請(薄色ピン用, task 2.9)
// pending_submissions_in_bbox(008) は明示列のみ返す(ip_hash 非返却 / Codex #8)。anon 公開 RPC なので publishable で呼ぶ。
export async function GET(request: NextRequest) {
  const bbox = request.nextUrl.searchParams.get("bbox");
  if (!bbox) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }
  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json(
      { error: "bbox format: minLng,minLat,maxLng,maxLat" },
      { status: 400 }
    );
  }
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];

  try {
    const supabase = getServerSupabasePublishable();
    const { data, error } = await supabase.rpc("pending_submissions_in_bbox", {
      min_lng: minLng,
      min_lat: minLat,
      max_lng: maxLng,
      max_lat: maxLat,
      result_limit: 500,
    });
    if (error) {
      console.error("[api/submissions] GET rpc error", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ submissions: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/submissions — トイレ追加申請(匿名可, task 2.8)
// 多層防御: IP rate limit(in-memory, 同一 IP×同一座標バケット) → submit_toilet RPC(DB側スロットル・dedup・昇格)。
export async function POST(request: NextRequest) {
  let body: SubmissionBody;
  try {
    body = (await request.json()) as SubmissionBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const lat = typeof body.lat === "number" ? body.lat : null;
  const lng = typeof body.lng === "number" ? body.lng : null;
  const accessLevel =
    typeof body.accessLevel === "string" ? body.accessLevel : null;
  const name =
    typeof body.name === "string" && body.name.trim() !== ""
      ? body.name.trim().slice(0, 120)
      : null;
  const isOutdoor = typeof body.isOutdoor === "boolean" ? body.isOutdoor : null;
  const isUniversal =
    typeof body.isUniversal === "boolean" ? body.isUniversal : null;
  const comment =
    typeof body.comment === "string" && body.comment.trim() !== ""
      ? body.comment.slice(0, 500)
      : null;

  if (lat == null || lng == null || !accessLevel) {
    return NextResponse.json(
      { error: "lat, lng, accessLevel are required" },
      { status: 400 }
    );
  }
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return NextResponse.json({ error: "lat/lng out of range" }, { status: 400 });
  }
  if (!ACCESS_VALUES.has(accessLevel)) {
    return NextResponse.json({ error: "invalid accessLevel" }, { status: 400 });
  }

  const ipHash = hashIp(extractIp(request));
  let coordKey: string;
  try {
    coordKey = makeCoordKey(lat, lng);
  } catch {
    return NextResponse.json({ error: "invalid coordinates" }, { status: 400 });
  }
  const limit = checkAndRecord(ipHash, `submission:${coordKey}`);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "同じ地点への申請は一定時間に1回までです" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } }
    );
  }

  try {
    const supabase = getServerSupabaseSecret();
    const { data, error } = await supabase.rpc("submit_toilet", {
      p_lat: lat,
      p_lng: lng,
      p_access: accessLevel,
      p_ip_hash: ipHash,
      p_name: name,
      p_is_outdoor: isOutdoor,
      p_is_universal: isUniversal,
      p_comment: comment,
    });
    if (error) {
      console.error("[api/submissions] POST rpc error", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          result?: string;
          submission_id?: string | null;
          toilet_id?: string | null;
          confirm_count?: number | null;
        }
      | undefined;

    switch (row?.result) {
      case "promoted":
        return NextResponse.json(
          { result: "promoted", toiletId: row.toilet_id ?? null },
          { status: 201 }
        );
      case "pending":
        return NextResponse.json(
          {
            result: "pending",
            submissionId: row.submission_id ?? null,
            confirmCount: row.confirm_count ?? null,
          },
          { status: 200 }
        );
      case "dup":
        return NextResponse.json(
          { result: "dup", toiletId: row.toilet_id ?? null },
          { status: 409 }
        );
      case "throttled":
        return NextResponse.json(
          {
            result: "throttled",
            error: "同じ地点への申請が混み合っています。少し時間をおいてください",
          },
          { status: 429, headers: { "retry-after": "300" } }
        );
      default:
        console.error("[api/submissions] unexpected rpc result", row);
        return NextResponse.json({ error: "unexpected rpc result" }, { status: 500 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
