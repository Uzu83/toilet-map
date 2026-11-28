import { NextResponse, type NextRequest } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { noStore, requireAdminMutation } from "@/lib/adminHttp";
import {
  ADMIN_WEBAUTHN_USER_ID,
  ADMIN_WEBAUTHN_USER_NAME,
  PASSKEY_TABLE,
  WEBAUTHN_RP_NAME,
  readPasskeyEnv,
  saveChallenge,
  setChallengeCookie,
} from "@/lib/adminPasskey";
import { getServerSupabaseSecret } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/passkey/register/options — パスキー登録の開始(Issue #61)。
// WHY ログイン済みの admin だけ: 登録できる人 = 管理画面に入れる人。未ログインの誰かが
//   自分のパスキーを足せないよう、既存の session + CSRF ガード(requireAdminMutation)を通す。
//   初回は従来のパスワードでログインしてから登録する。
export async function POST(request: NextRequest) {
  const guard = await requireAdminMutation(request);
  if (!guard.ok) return guard.res;

  const envResult = readPasskeyEnv();
  if (!envResult.ok) {
    console.error("[api/admin/passkey/register/options] passkey env not configured", {
      missing: envResult.missing,
    });
    return noStore(NextResponse.json({ error: "not configured" }, { status: 503 }));
  }
  const { rpID } = envResult.env;

  const supabase = getServerSupabaseSecret();
  const { data: rows, error } = await supabase.from(PASSKEY_TABLE).select("credential_id, transports");
  if (error) {
    console.error("[api/admin/passkey/register/options] passkey list failed", { code: error.code });
    return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
  }
  const existing = (rows ?? []) as Array<{ credential_id: string; transports: string[] | null }>;

  const options = await generateRegistrationOptions({
    rpName: WEBAUTHN_RP_NAME,
    rpID,
    userName: ADMIN_WEBAUTHN_USER_NAME,
    userDisplayName: "Loo map 管理者",
    userID: ADMIN_WEBAUTHN_USER_ID,
    attestationType: "none",
    // 同じ端末に二重登録しない。
    excludeCredentials: existing.map((r) => ({ id: r.credential_id, transports: r.transports ?? undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });

  const challengeId = await saveChallenge(supabase, "registration", options.challenge, Date.now());
  if (!challengeId) {
    return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
  }

  const res = noStore(NextResponse.json(options));
  setChallengeCookie(res, challengeId);
  return res;
}
