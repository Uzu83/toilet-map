import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, signSession } from "@/lib/adminAuth";

// proxy の /admin 早期ゲート(Issue #61): パスキー導入後も管理ページと登録 API は守られ、
// ログイン導線(ページ・パスワード API・パスキーログイン API)だけが素通しになることを確かめる。

vi.mock("next-intl/middleware", () => ({
  default: () => () => new Response("intl"),
}));

const { default: proxy } = await import("@/proxy");

const SECRET = "proxy-test-secret";

function get(path: string, cookie?: string, method = "GET") {
  return new NextRequest(`https://loomap.test${path}`, {
    method,
    headers: cookie ? { cookie: `${ADMIN_COOKIE_NAME}=${cookie}` } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy /admin gate", () => {
  it("未ログインの /admin はログイン画面へリダイレクト", async () => {
    const res = await proxy(get("/admin"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://loomap.test/admin/login?next=%2Fadmin");
  });

  it("未ログインのパスキー登録 API は 401", async () => {
    for (const p of ["/api/admin/passkey/register/options", "/api/admin/passkey/register/verify"]) {
      const res = await proxy(get(p, undefined, "POST"));
      expect(res.status).toBe(401);
    }
  });

  it("ログイン導線は未ログインでも通す", async () => {
    for (const p of [
      "/admin/login",
      "/api/admin/login",
      "/api/admin/passkey/login/options",
      "/api/admin/passkey/login/verify",
    ]) {
      const res = await proxy(get(p, undefined, "POST"));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("似た名前のパスは例外にならない", async () => {
    const res = await proxy(get("/api/admin/passkey/login/verify/extra", undefined, "POST"));
    expect(res.status).toBe(401);
  });

  it("有効なセッション cookie なら /admin と登録 API を通す", async () => {
    const cookie = signSession({ exp: Math.floor(Date.now() / 1000) + 60, role: "admin" }, SECRET);
    expect((await proxy(get("/admin", cookie))).headers.get("x-middleware-next")).toBe("1");
    expect(
      (await proxy(get("/api/admin/passkey/register/options", cookie, "POST"))).headers.get("x-middleware-next"),
    ).toBe("1");
  });

  it("ADMIN_SESSION_SECRET 未設定ならフェイルクローズ", async () => {
    const cookie = signSession({ exp: Math.floor(Date.now() / 1000) + 60, role: "admin" }, SECRET);
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    expect((await proxy(get("/admin", cookie))).status).toBe(307);
  });
});
