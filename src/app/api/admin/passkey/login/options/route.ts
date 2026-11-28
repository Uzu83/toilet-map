import { NextResponse, type NextRequest } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { isSameOrigin } from "@/lib/adminAuth";
import { noStore } from "@/lib/adminHttp";
import { LOGIN_LIMIT, LOGIN_LIMIT_KEY, loginThrottleIp } from "@/lib/adminLoginThrottle";
import { readPasskeyEnv, saveChallenge, setChallengeCookie } from "@/lib/adminPasskey";
import { hashIp, peekAttempts } from "@/lib/rateLimit";
import { getServerSupabaseSecret } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/passkey/login/options — パスキーログインの開始(Issue #61)。
// proxy ではログイン導線として素通しにしているので、防御はこの route が持つ:
//   ①同一オリジン ②パスワードログインと共有の失敗回数スロットル ③env フェイルクローズ。
// allowCredentials は空にする(端末にある discoverable credential を選ばせる)。
//   WHY: 登録済み credential ID を未ログインの相手に返さないため。
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return noStore(NextResponse.json({ error: "bad origin" }, { status: 403 }));
  }

  const limit = peekAttempts(hashIp(loginThrottleIp(request)), LOGIN_LIMIT_KEY, LOGIN_LIMIT);
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
    console.error("[api/admin/passkey/login/options] passkey env not configured", {
      missing: envResult.missing,
    });
    return noStore(NextResponse.json({ error: "not configured" }, { status: 503 }));
  }

  const options = await generateAuthenticationOptions({
    rpID: envResult.env.rpID,
    userVerification: "required",
  });

  const challengeId = await saveChallenge(
    getServerSupabaseSecret(),
    "authentication",
    options.challenge,
    Date.now(),
  );
  if (!challengeId) {
    return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
  }

  const res = noStore(NextResponse.json(options));
  setChallengeCookie(res, challengeId);
  return res;
}
