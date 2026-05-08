import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabasePublishable } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const bbox = request.nextUrl.searchParams.get("bbox");
  if (!bbox) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }
  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "bbox format: minLng,minLat,maxLng,maxLat" }, { status: 400 });
  }
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];

  try {
    const supabase = getServerSupabasePublishable();
    const { data, error } = await supabase.rpc("toilets_in_bbox", {
      min_lng: minLng,
      min_lat: minLat,
      max_lng: maxLng,
      max_lat: maxLat,
      result_limit: 500,
    });
    if (error) {
      console.error("[api/toilets] supabase error", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ toilets: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
