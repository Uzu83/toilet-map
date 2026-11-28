import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAdminSessionMock, resetAdminSession } from "../__tests__/helpers";
import { makeFakeDb, makeFakeSupabase, type FakeDb } from "./__tests__/fakeSupabase";
import { ADMIN_COOKIE_NAME, verifySession } from "@/lib/adminAuth";
import { WEBAUTHN_CHALLENGE_COOKIE, WEBAUTHN_CHALLENGE_TTL_SEC } from "@/lib/adminPasskey";

// テストの射程: パスキー 4 route の「ガード・challenge の 1 回限り / 期限・保存・セッション発行」。
// WebAuthn の暗号検証そのものは @simplewebauthn/server の責務なので verify* はモックする。

vi.mock("@/lib/adminSession", () => ({
  getAdminSession: () => getAdminSessionMock(),
}));

let db: FakeDb;
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseSecret: () => makeFakeSupabase(db),
}));

const generateRegistrationOptionsMock = vi.fn();
const verifyRegistrationResponseMock = vi.fn();
const generateAuthenticationOptionsMock = vi.fn();
const verifyAuthenticationResponseMock = vi.fn();
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (o: unknown) => generateRegistrationOptionsMock(o),
  verifyRegistrationResponse: (o: unknown) => verifyRegistrationResponseMock(o),
  generateAuthenticationOptions: (o: unknown) => generateAuthenticationOptionsMock(o),
  verifyAuthenticationResponse: (o: unknown) => verifyAuthenticationResponseMock(o),
}));

const { POST: registerOptions } = await import("./register/options/route");
const { POST: registerVerify } = await import("./register/verify/route");
const { POST: loginOptions } = await import("./login/options/route");
const { POST: loginVerify } = await import("./login/verify/route");

const SECRET = "test-session-secret";
const RP_ID = "loomap.test";
const ORIGIN = "https://loomap.test";

const CREDENTIAL = {
  id: "cred-1",
  rawId: "cred-1",
  type: "public-key",
  response: { clientDataJSON: "x", authenticatorData: "y", signature: "z" },
  clientExtensionResults: {},
};

function req(
  path: string,
  opts: { body?: unknown; cookie?: string; sameOrigin?: boolean; ip?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {
    host: "loomap.test",
    origin: opts.sameOrigin === false ? "https://evil.test" : ORIGIN,
    // 失敗回数スロットル(in-memory)をテスト間で共有しないよう、毎回別 IP にする。
    "x-real-ip": opts.ip ?? randomUUID(),
  };
  if (opts.cookie) headers.cookie = `${WEBAUTHN_CHALLENGE_COOKIE}=${opts.cookie}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

function challengeCookieOf(res: Response): string | undefined {
  const set = res.headers.getSetCookie().find((c) => c.startsWith(`${WEBAUTHN_CHALLENGE_COOKIE}=`));
  return set?.split(";")[0].split("=")[1];
}

function sessionCookieOf(res: Response): string | undefined {
  const set = res.headers.getSetCookie().find((c) => c.startsWith(`${ADMIN_COOKIE_NAME}=`));
  return set?.split(";")[0].split("=").slice(1).join("=");
}

beforeEach(() => {
  db = makeFakeDb();
  resetAdminSession();
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
  vi.stubEnv("ADMIN_WEBAUTHN_RP_ID", RP_ID);
  vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", ORIGIN);
  generateRegistrationOptionsMock.mockReset().mockResolvedValue({ challenge: "registration-challenge-1234" });
  generateAuthenticationOptionsMock.mockReset().mockResolvedValue({ challenge: "authentication-challenge-1234" });
  verifyRegistrationResponseMock.mockReset().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: { id: "cred-1", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] },
    },
  });
  verifyAuthenticationResponseMock.mockReset().mockResolvedValue({
    verified: true,
    authenticationInfo: { credentialID: "cred-1", newCounter: 7 },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function seedPasskey() {
  db.tables.admin_passkeys.push({
    credential_id: "cred-1",
    public_key: Buffer.from([1, 2, 3]).toString("base64url"),
    counter: 3,
    transports: ["internal"],
  });
}

// ───────────────────────────────────────────────────────────────────
// 登録
// ───────────────────────────────────────────────────────────────────
describe("POST /api/admin/passkey/register/*", () => {
  it("未ログインは options も verify も 401(登録させない)", async () => {
    getAdminSessionMock.mockReturnValue(null);
    expect((await registerOptions(req("/api/admin/passkey/register/options"))).status).toBe(401);
    expect(
      (await registerVerify(req("/api/admin/passkey/register/verify", { body: CREDENTIAL }))).status,
    ).toBe(401);
    expect(generateRegistrationOptionsMock).not.toHaveBeenCalled();
    expect(verifyRegistrationResponseMock).not.toHaveBeenCalled();
    expect(db.tables.admin_passkeys).toHaveLength(0);
  });

  it("別オリジンは 403", async () => {
    const res = await registerOptions(req("/api/admin/passkey/register/options", { sameOrigin: false }));
    expect(res.status).toBe(403);
  });

  it("env 未設定は 503(フェイルクローズ)", async () => {
    vi.stubEnv("ADMIN_WEBAUTHN_RP_ID", "");
    const res = await registerOptions(req("/api/admin/passkey/register/options"));
    expect(res.status).toBe(503);
  });

  it("options → verify で公開鍵が保存される", async () => {
    const optRes = await registerOptions(req("/api/admin/passkey/register/options"));
    expect(optRes.status).toBe(200);
    expect(generateRegistrationOptionsMock.mock.calls[0][0]).toMatchObject({
      rpID: RP_ID,
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const cookie = challengeCookieOf(optRes);
    expect(cookie).toBeTruthy();
    expect(optRes.headers.getSetCookie().join(";")).toMatch(/HttpOnly/i);
    expect(optRes.headers.getSetCookie().join(";")).toMatch(/SameSite=strict/i);

    const res = await registerVerify(req("/api/admin/passkey/register/verify", { body: CREDENTIAL, cookie }));
    expect(res.status).toBe(200);
    expect(verifyRegistrationResponseMock.mock.calls[0][0]).toMatchObject({
      expectedChallenge: "registration-challenge-1234",
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    expect(db.tables.admin_passkeys).toEqual([
      {
        credential_id: "cred-1",
        public_key: Buffer.from([1, 2, 3]).toString("base64url"),
        counter: 0,
        transports: ["internal"],
      },
    ]);
    expect(db.tables.admin_webauthn_challenges).toHaveLength(0);
  });

  it("登録済みのパスキーは excludeCredentials に入る", async () => {
    seedPasskey();
    await registerOptions(req("/api/admin/passkey/register/options"));
    expect(generateRegistrationOptionsMock.mock.calls[0][0].excludeCredentials).toEqual([
      { id: "cred-1", transports: ["internal"] },
    ]);
  });

  it("challenge cookie が無いと 400 で、検証も保存もしない", async () => {
    const res = await registerVerify(req("/api/admin/passkey/register/verify", { body: CREDENTIAL }));
    expect(res.status).toBe(400);
    expect(verifyRegistrationResponseMock).not.toHaveBeenCalled();
    expect(db.tables.admin_passkeys).toHaveLength(0);
  });

  it("verified=false なら保存しない", async () => {
    verifyRegistrationResponseMock.mockResolvedValue({ verified: false });
    const cookie = challengeCookieOf(await registerOptions(req("/api/admin/passkey/register/options")));
    const res = await registerVerify(req("/api/admin/passkey/register/verify", { body: CREDENTIAL, cookie }));
    expect(res.status).toBe(400);
    expect(db.tables.admin_passkeys).toHaveLength(0);
  });

  it("検証ライブラリが throw しても 400(500 にしない)", async () => {
    verifyRegistrationResponseMock.mockRejectedValue(new Error("bad attestation"));
    const cookie = challengeCookieOf(await registerOptions(req("/api/admin/passkey/register/options")));
    const res = await registerVerify(req("/api/admin/passkey/register/verify", { body: CREDENTIAL, cookie }));
    expect(res.status).toBe(400);
  });

  it("同じ credential の二重登録は 409", async () => {
    seedPasskey();
    const cookie = challengeCookieOf(await registerOptions(req("/api/admin/passkey/register/options")));
    const res = await registerVerify(req("/api/admin/passkey/register/verify", { body: CREDENTIAL, cookie }));
    expect(res.status).toBe(409);
  });

  it("ログイン用の challenge は登録に使えない", async () => {
    const cookie = challengeCookieOf(await loginOptions(req("/api/admin/passkey/login/options")));
    const res = await registerVerify(req("/api/admin/passkey/register/verify", { body: CREDENTIAL, cookie }));
    expect(res.status).toBe(400);
    expect(verifyRegistrationResponseMock).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────
// ログイン
// ───────────────────────────────────────────────────────────────────
describe("POST /api/admin/passkey/login/*", () => {
  it("options は未ログインでも使える(discoverable なので credential ID を返さない)", async () => {
    getAdminSessionMock.mockReturnValue(null);
    const res = await loginOptions(req("/api/admin/passkey/login/options"));
    expect(res.status).toBe(200);
    const arg = generateAuthenticationOptionsMock.mock.calls[0][0];
    expect(arg).toEqual({ rpID: RP_ID, userVerification: "required" });
    expect(challengeCookieOf(res)).toBeTruthy();
    expect(db.tables.admin_webauthn_challenges).toHaveLength(1);
    expect(db.tables.admin_webauthn_challenges[0].purpose).toBe("authentication");
  });

  it("別オリジンは options / verify とも 403", async () => {
    expect((await loginOptions(req("/api/admin/passkey/login/options", { sameOrigin: false }))).status).toBe(403);
    expect(
      (await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, sameOrigin: false }))).status,
    ).toBe(403);
  });

  it("env 未設定は 503", async () => {
    vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", "");
    expect((await loginOptions(req("/api/admin/passkey/login/options"))).status).toBe(503);
  });

  it("登録済みパスキーで検証できればセッション cookie が出て、counter が進む", async () => {
    seedPasskey();
    const cookie = challengeCookieOf(await loginOptions(req("/api/admin/passkey/login/options")));
    const res = await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, cookie }));
    expect(res.status).toBe(200);

    const call = verifyAuthenticationResponseMock.mock.calls[0][0];
    expect(call).toMatchObject({
      expectedChallenge: "authentication-challenge-1234",
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: { id: "cred-1", counter: 3, transports: ["internal"] },
    });
    expect(Array.from(call.credential.publicKey)).toEqual([1, 2, 3]);

    const session = sessionCookieOf(res);
    expect(session).toBeTruthy();
    expect(verifySession(decodeURIComponent(session!), SECRET, Math.floor(Date.now() / 1000))?.role).toBe("admin");
    expect(res.headers.getSetCookie().join(";")).toMatch(/HttpOnly/i);
    expect(db.tables.admin_passkeys[0].counter).toBe(7);
    expect(db.tables.admin_passkeys[0].last_used_at).toBeTruthy();
  });

  it("登録されていない credential は 401 で、検証もしない", async () => {
    const cookie = challengeCookieOf(await loginOptions(req("/api/admin/passkey/login/options")));
    const res = await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, cookie }));
    expect(res.status).toBe(401);
    expect(verifyAuthenticationResponseMock).not.toHaveBeenCalled();
    expect(sessionCookieOf(res)).toBeUndefined();
  });

  it("署名が検証できなければ 401(セッションを出さない)", async () => {
    seedPasskey();
    verifyAuthenticationResponseMock.mockResolvedValue({
      verified: false,
      authenticationInfo: { credentialID: "cred-1", newCounter: 0 },
    });
    const cookie = challengeCookieOf(await loginOptions(req("/api/admin/passkey/login/options")));
    const res = await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, cookie }));
    expect(res.status).toBe(401);
    expect(sessionCookieOf(res)).toBeUndefined();
    expect(db.tables.admin_passkeys[0].counter).toBe(3);
  });

  it("ライブラリが throw(counter 巻き戻り等)しても 401", async () => {
    seedPasskey();
    verifyAuthenticationResponseMock.mockRejectedValue(new Error("counter"));
    const cookie = challengeCookieOf(await loginOptions(req("/api/admin/passkey/login/options")));
    const res = await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, cookie }));
    expect(res.status).toBe(401);
  });

  it("challenge は 1 回だけ: 同じ cookie での 2 回目は 400", async () => {
    seedPasskey();
    const cookie = challengeCookieOf(await loginOptions(req("/api/admin/passkey/login/options")));
    const first = await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, cookie }));
    expect(first.status).toBe(200);
    const second = await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, cookie }));
    expect(second.status).toBe(400);
    expect(sessionCookieOf(second)).toBeUndefined();
    expect(verifyAuthenticationResponseMock).toHaveBeenCalledTimes(1);
  });

  it("検証に失敗した challenge も使い捨て(再送できない)", async () => {
    seedPasskey();
    verifyAuthenticationResponseMock.mockResolvedValueOnce({
      verified: false,
      authenticationInfo: { credentialID: "cred-1", newCounter: 0 },
    });
    const cookie = challengeCookieOf(await loginOptions(req("/api/admin/passkey/login/options")));
    expect((await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, cookie }))).status).toBe(401);
    expect((await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, cookie }))).status).toBe(400);
  });

  it("期限切れの challenge は 400(検証しない)", async () => {
    seedPasskey();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-28T00:00:00Z"));
    const cookie = challengeCookieOf(await loginOptions(req("/api/admin/passkey/login/options")));
    vi.setSystemTime(new Date(Date.parse("2026-11-28T00:00:00Z") + WEBAUTHN_CHALLENGE_TTL_SEC * 1000 + 1));
    const res = await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, cookie }));
    expect(res.status).toBe(400);
    expect(verifyAuthenticationResponseMock).not.toHaveBeenCalled();
    // 期限切れの行も取り出した時点で消える
    expect(db.tables.admin_webauthn_challenges).toHaveLength(0);
  });

  it("期限内なら通る(TTL ぎりぎり手前)", async () => {
    seedPasskey();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-28T00:00:00Z"));
    const cookie = challengeCookieOf(await loginOptions(req("/api/admin/passkey/login/options")));
    vi.setSystemTime(new Date(Date.parse("2026-11-28T00:00:00Z") + WEBAUTHN_CHALLENGE_TTL_SEC * 1000 - 1000));
    const res = await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, cookie }));
    expect(res.status).toBe(200);
  });

  it("登録用の challenge はログインに使えない", async () => {
    seedPasskey();
    const cookie = challengeCookieOf(await registerOptions(req("/api/admin/passkey/register/options")));
    const res = await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, cookie }));
    expect(res.status).toBe(400);
  });

  it("失敗が続くと 429(パスワードログインと同じ枠)", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 5; i++) {
      const res = await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, ip }));
      expect(res.status).toBe(400);
    }
    expect((await loginVerify(req("/api/admin/passkey/login/verify", { body: CREDENTIAL, ip }))).status).toBe(429);
    expect((await loginOptions(req("/api/admin/passkey/login/options", { ip }))).status).toBe(429);
  });

  it("形の崩れた応答は 400", async () => {
    const res = await loginVerify(req("/api/admin/passkey/login/verify", { body: { id: 1 } }));
    expect(res.status).toBe(400);
  });
});
