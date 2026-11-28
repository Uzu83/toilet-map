import { NextResponse, type NextRequest } from "next/server";
import { checkPassword, isSameOrigin, readAdminEnv } from "@/lib/adminAuth";
import { noStore, setAdminSessionCookie } from "@/lib/adminHttp";
import { LOGIN_LIMIT, LOGIN_LIMIT_KEY, loginThrottleIp } from "@/lib/adminLoginThrottle";
import { hashIp, peekAttempts, recordAttempt } from "@/lib/rateLimit";

// secret(ADMIN_PASSWORD / ADMIN_SESSION_SECRET)を読むため Node ランタイム固定。
export const runtime = "nodejs";
// 管理系は静的化・キャッシュさせない(layout と同方針)。
export const dynamic = "force-dynamic";

type LoginBody = { password?: unknown };

// POST /api/admin/login — パスワード照合 → 成功で署名 cookie を発行。
// proxy ではこの route を「認証の例外(素通し)」にしている(自己ロックアウト回避)。
// したがって防御はこの route 自身が担う: ①同一オリジン(CSRF)②per-IP rate limit ③constant-time 照合 ④env フェイルクローズ。
export async function POST(request: NextRequest) {
  // ① CSRF: cookie を発行する変更系なので、リクエストが自サイト由来かを確認する。
  // WHY: 攻撃サイトが勝手にこのエンドポイントを叩いてもオリジンが異なれば弾く(SameSite=Lax と併用)。
  if (!isSameOrigin(request)) {
    return noStore(NextResponse.json({ error: "bad origin" }, { status: 403 }));
  }

  // ② per-IP rate limit(ブルートフォース抑止)。カウンタ式(15 分に 5 回)で、上限到達なら照合前に弾く。
  //   注意: in-memory なのでサーバーレスではインスタンス境界で甘くなる(Phase 2 で DB 化検討)。
  //   IP ソースは login 専用 loginThrottleIp(信頼できる x-real-ip のみ、無ければ単一バケット=詐称で緩めない)。
  const ipHash = hashIp(loginThrottleIp(request));
  const limit = peekAttempts(ipHash, LOGIN_LIMIT_KEY, LOGIN_LIMIT);
  if (!limit.ok) {
    // ログにも残す(秘密値は出さない。IP ハッシュは PII を直接含まない短縮ハッシュ)。
    console.warn("[api/admin/login] rate limited", { retryAfterSec: limit.retryAfterSec });
    return noStore(
      NextResponse.json(
        { error: "too many attempts" },
        { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } }
      )
    );
  }

  // パスワードログインの停止(Issue #61): パスキー導入後は ADMIN_PASSWORD を消せばこの経路は使えない。
  //   パスキーを失くしたときは ADMIN_PASSWORD を設定し直せば戻る。
  // WHY 403(503 ではない): 設定不備ではなく、意図して止めている状態だから。
  if ((process.env.ADMIN_PASSWORD ?? "").length === 0) {
    return noStore(NextResponse.json({ error: "password login disabled" }, { status: 403 }));
  }

  // ④ env フェイルクローズ: ADMIN_PASSWORD / ADMIN_SESSION_SECRET 未設定なら誰もログインさせない。
  // WHY 503: 「設定不備」であってクライアントの誤りではない。秘密値も「どちらが欠けているか」も
  //   レスポンスには出さない(missing はサーバログにのみ)。
  const envResult = readAdminEnv();
  if (!envResult.ok) {
    console.error("[api/admin/login] admin env not configured", {
      missing: envResult.missing,
    });
    return noStore(NextResponse.json({ error: "not configured" }, { status: 503 }));
  }
  const { password: expected, secret } = envResult.env;

  // ボディ(JSON)から password を取り出す。
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return noStore(NextResponse.json({ error: "invalid json" }, { status: 400 }));
  }
  const input = typeof body.password === "string" ? body.password : null;
  if (input === null) {
    return noStore(NextResponse.json({ error: "password required" }, { status: 400 }));
  }

  // ③ constant-time 照合。タイミング攻撃でパスワードを 1 文字ずつ推測されないようにする。
  if (!checkPassword(input, expected)) {
    // WHY ここで初めて recordAttempt: 失敗(誤入力 or 攻撃)のときだけ枠を消費する。
    //   正しいパスワードでの成功は枠を食わない → typo を直して再試行した正規操作を締め出さない。
    recordAttempt(ipHash, LOGIN_LIMIT_KEY, LOGIN_LIMIT);
    // 失敗ログ(秘密値・入力値は出さない)。IP ハッシュのみで攻撃の傾向は追える。
    console.warn("[api/admin/login] failed login attempt");
    return noStore(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  }

  // 成功: 短命(例 12h)の署名 cookie を発行する(発行処理はパスキーログインと共有)。
  const res = noStore(NextResponse.json({ ok: true }));
  setAdminSessionCookie(res, secret);
  return res;
}
