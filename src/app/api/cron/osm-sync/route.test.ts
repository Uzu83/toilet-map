import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/osmSync/execute", () => ({
  executeOsmSync: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseSecret: () => ({ rpc: async () => ({ data: null, error: null }) }),
}));

import { executeOsmSync } from "@/lib/osmSync/execute";
import { GET, POST } from "@/app/api/cron/osm-sync/route";

const runSync = vi.mocked(executeOsmSync);

const SECRET = "route-test-secret";

function request(method: "GET" | "POST", authorization?: string) {
  return new NextRequest("https://loomap.test/api/cron/osm-sync", {
    method,
    headers: authorization ? { authorization } : {},
  });
}

afterEach(() => {
    runSync.mockReset();
  delete process.env.CRON_SECRET;
});

describe("/api/cron/osm-sync", () => {
  it("秘密が無い、または違うと 401 で同期しない", async () => {
    process.env.CRON_SECRET = SECRET;
    const missing = await GET(request("GET"));
    const wrong = await POST(request("POST", "Bearer not-the-secret"));
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(runSync).not.toHaveBeenCalled();
    expect(JSON.stringify(await missing.json())).not.toContain(SECRET);
  });

  it("一致した Bearer のときだけ同期し、レスポンスに秘密を含めない", async () => {
    process.env.CRON_SECRET = SECRET;
    runSync.mockResolvedValue({
      httpStatus: 200,
      body: { ok: true, status: "ok", queries: 1, prefectures: ["JP-01"] },
    });
    const response = await GET(request("GET", `Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: "ok",
      queries: 1,
      prefectures: ["JP-01"],
    });
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(runSync.mock.calls)).not.toContain(SECRET);
  });
});
