import { NextResponse, type NextRequest } from "next/server";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isSameOrigin } from "@/lib/adminAuth";
import { noStore, setAdminSessionCookie } from "@/lib/adminHttp";
import { LOGIN_LIMIT, LOGIN_LIMIT_KEY, loginThrottleIp } from "@/lib/adminLoginThrottle";
import {
  PASSKEY_TABLE,
  WEBAUTHN_CHALLENGE_COOKIE,
  clearChallengeCookie,
  consumeChallenge,
  looksLikeCredentialResponse,
  readPasskeyEnv,
} from "@/lib/adminPasskey";
import { hashIp, peekAttempts, recordAttempt } from "@/lib/rateLimit";
import { getServerSupabaseSecret } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PasskeyRow = {
  credential_id: string;
  public_key: string;
  counter: number | string;
  transports: string[] | null;
};

function respond(status: number, body: Record<string, unknown>) {
  const res = noStore(NextResponse.json(body, { status }));
  clearChallengeCookie(res);
  return res;
}

// POST /api/admin/passkey/login/verify — パスキーの署名を検証し、成功なら既存の admin セッション cookie を発行する。
// 登録済みの公開鍵で検証できない応答はすべて 401(= 登録されていない人は入れない)。
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return noStore(NextResponse.json({ error: "bad origin" }, { status: 403 }));
  }

  const ipHash = hashIp(loginThrottleIp(request));
  const limit = peekAttempts(ipHash, LOGIN_LIMIT_KEY, LOGIN_LIMIT);
  if (!limit.ok) {
    return noStore(
      NextResponse.json(
        { error: "too many attempts" },
        { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
      ),
    );
  }

  const envResult = readPasskeyEnv();
  if (!envResult.ok) {
    console.error("[api/admin/passkey/login/verify] passkey env not configured", {
      missing: envResult.missing,
    });
    return noStore(NextResponse.json({ error: "not configured" }, { status: 503 }));
  }
  const { rpID, origin, secret } = envResult.env;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "invalid json" });
  }
  if (!looksLikeCredentialResponse(body)) return respond(400, { error: "invalid credential" });

  const supabase = getServerSupabaseSecret();
  // challenge は 1 回だけ。成功・失敗にかかわらずここで消える。
  const challenge = await consumeChallenge(
    supabase,
    request.cookies.get(WEBAUTHN_CHALLENGE_COOKIE)?.value,
    "authentication",
    Date.now(),
  );
  if (!challenge) {
    recordAttempt(ipHash, LOGIN_LIMIT_KEY, LOGIN_LIMIT);
    return respond(400, { error: "challenge expired" });
  }

  const { data, error } = await supabase
    .from(PASSKEY_TABLE)
    .select("credential_id, public_key, counter, transports")
    .eq("credential_id", body.id)
    .maybeSingle();
  if (error) {
    console.error("[api/admin/passkey/login/verify] passkey lookup failed", { code: error.code });
    return respond(500, { error: "internal error" });
  }
  const row = data as PasskeyRow | null;
  if (!row) {
    recordAttempt(ipHash, LOGIN_LIMIT_KEY, LOGIN_LIMIT);
    console.warn("[api/admin/passkey/login/verify] unknown credential");
    return respond(401, { error: "unauthorized" });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: row.credential_id,
        publicKey: new Uint8Array(Buffer.from(row.public_key, "base64url")),
        counter: Number(row.counter),
        transports: row.transports ?? undefined,
      },
      requireUserVerification: true,
    });
  } catch (e) {
    console.warn("[api/admin/passkey/login/verify] verification error", {
      name: e instanceof Error ? e.name : "unknown",
    });
    verification = null;
  }
  if (!verification || !verification.verified) {
    recordAttempt(ipHash, LOGIN_LIMIT_KEY, LOGIN_LIMIT);
    return respond(401, { error: "unauthorized" });
  }

  // 署名カウンタを進める(クローンされた鍵の検知はライブラリが counter 比較で行う)。
  // 更新に失敗したらログインさせない(フェイルクローズ)。
  const { error: updateErr } = await supabase
    .from(PASSKEY_TABLE)
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("credential_id", row.credential_id);
  if (updateErr) {
    console.error("[api/admin/passkey/login/verify] counter update failed", { code: updateErr.code });
    return respond(500, { error: "internal error" });
  }

  const res = respond(200, { ok: true });
  setAdminSessionCookie(res, secret);
  return res;
}
