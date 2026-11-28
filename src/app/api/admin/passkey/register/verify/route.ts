import { NextResponse, type NextRequest } from "next/server";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { noStore, requireAdminMutation } from "@/lib/adminHttp";
import {
  PASSKEY_TABLE,
  WEBAUTHN_CHALLENGE_COOKIE,
  clearChallengeCookie,
  consumeChallenge,
  looksLikeCredentialResponse,
  readPasskeyEnv,
} from "@/lib/adminPasskey";
import { getServerSupabaseSecret } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  const res = noStore(NextResponse.json({ error }, { status }));
  clearChallengeCookie(res);
  return res;
}

// POST /api/admin/passkey/register/verify — 登録の完了。署名を検証して公開鍵を保存する(Issue #61)。
// options と同じく、ログイン済み admin + 同一オリジンのときだけ受け付ける。
export async function POST(request: NextRequest) {
  const guard = await requireAdminMutation(request);
  if (!guard.ok) return guard.res;

  const envResult = readPasskeyEnv();
  if (!envResult.ok) {
    console.error("[api/admin/passkey/register/verify] passkey env not configured", {
      missing: envResult.missing,
    });
    return noStore(NextResponse.json({ error: "not configured" }, { status: 503 }));
  }
  const { rpID, origin } = envResult.env;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid json");
  }
  if (!looksLikeCredentialResponse(body)) return fail(400, "invalid credential");

  const supabase = getServerSupabaseSecret();
  // challenge は 1 回だけ。成功・失敗にかかわらずここで消える。
  const challenge = await consumeChallenge(
    supabase,
    request.cookies.get(WEBAUTHN_CHALLENGE_COOKIE)?.value,
    "registration",
    Date.now(),
  );
  if (!challenge) return fail(400, "challenge expired");

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    console.warn("[api/admin/passkey/register/verify] verification error", {
      name: e instanceof Error ? e.name : "unknown",
    });
    return fail(400, "verification failed");
  }
  if (!verification.verified) return fail(400, "verification failed");

  const { credential } = verification.registrationInfo;
  const { error } = await supabase.from(PASSKEY_TABLE).insert({
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports ?? [],
  });
  if (error) {
    if (error.code === "23505") return fail(409, "already registered");
    console.error("[api/admin/passkey/register/verify] passkey insert failed", { code: error.code });
    return fail(500, "internal error");
  }

  const res = noStore(NextResponse.json({ ok: true }));
  clearChallengeCookie(res);
  return res;
}
