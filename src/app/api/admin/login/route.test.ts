import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/adminAuth";
import { POST } from "./route";

// パスワードログイン(Issue #61): ADMIN_PASSWORD を消せば止まり、設定し直せば戻る。

function req(password: string) {
  return new NextRequest("https://loomap.test/api/admin/login", {
    method: "POST",
    headers: {
      host: "loomap.test",
      origin: "https://loomap.test",
      "content-type": "application/json",
      "x-real-ip": randomUUID(),
    },
    body: JSON.stringify({ password }),
  });
}

beforeEach(() => {
  vi.stubEnv("ADMIN_SESSION_SECRET", "login-test-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/login", () => {
  it("ADMIN_PASSWORD が空ならパスワードログインは 403(止めている)", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    const res = await POST(req(""));
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${ADMIN_COOKIE_NAME}=`))).toBe(false);
  });

  it("ADMIN_PASSWORD を設定すれば正しいパスワードで入れる", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "correct horse battery staple");
    const res = await POST(req("correct horse battery staple"));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${ADMIN_COOKIE_NAME}=`))).toBe(true);
  });

  it("違うパスワードは 401", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "correct horse battery staple");
    expect((await POST(req("wrong"))).status).toBe(401);
  });
});
