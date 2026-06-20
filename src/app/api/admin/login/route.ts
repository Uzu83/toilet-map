import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_SEC,
  checkPassword,
  isSameOrigin,
  readAdminEnv,
  signSession,
} from "@/lib/adminAuth";
import { noStore } from "@/lib/adminHttp";
import { hashIp, peekAttempts, recordAttempt } from "@/lib/rateLimit";

// secret(ADMIN_PASSWORD / ADMIN_SESSION_SECRET)を読むため Node ランタイム固定。
export const runtime = "nodejs";
// 管理系は静的化・キャッシュさせない(layout と同方針)。
export const dynamic = "force-dynamic";

type LoginBody = { password?: unknown };

// ログイン専用の rate limit ポリシー(カウンタ式)。
// WHY checkAndRecord(窓内 1 回)を流用しない: それは reviews 用(同一 IP×トイレ=1時間1件)で、
//   ログインに当てると「1 時間に 1 回しか試行できない」= typo 1 回 / cookie 失効後の再ログインで ~1 時間ロックアウト
//   というソロ admin の自己ロックアウト(可用性回帰)になる。ログインは「失敗を数回まで許す」スロットルが正しい。
// WHY 失敗時のみ枠を消費(成功は食わない): peekAttempts で上限到達なら照合前に弾き、照合に失敗したときだけ recordAttempt。
//   → 正しいパスワードでの連続ログインは枠を減らさず、誤入力(攻撃 or typo)だけが枠を食う。
// max=5 / windowMs=15分 の根拠(厳しすぎ ↔ 緩すぎ のトレードオフ):
//   - 厳しすぎる(例 3 回 / 1h): 運営本人が typo を 2〜3 回しただけで長時間締め出される(可用性回帰)。
//     ソロ admin はパスワードマネージャ未使用で手打ちすることもあり、数回の打ち間違いは正常運用の範囲。
//   - 緩すぎる(例 100 回 / 1分): 総当たり試行を実質許してしまい limiter の意味が薄れる。
//   - 5 回 / 15 分 ≒ 「人間の打ち間違い数回は許容、機械的な総当たりは即頭打ち」の妥協点。
//   ⚠️ あくまで補助。主防御は ADMIN_PASSWORD の constant-time 照合(下記 loginThrottleIp の WHY 参照)。
//     この limiter は in-memory・per-instance のベストエフォートで、サーバーレスではインスタンス境界で甘くなる。
//     よって「ここを厳しくすれば総当たりを防げる」と過信しない(数字を絞っても per-instance の穴は残る)。
const LOGIN_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 } as const; // 15 分に 5 回まで
const LOGIN_LIMIT_KEY = "admin-login";

// ───────────────────────────────────────────────────────────────────
// login 専用の IP ソース(Codex medium: クライアント供給 XFF を throttle の唯一の根拠にしない)
// ───────────────────────────────────────────────────────────────────
// 共用の extractIp(reviews/submissions)は x-real-ip → x-forwarded-for 先頭 → 0.0.0.0 とフォールバックする。
// login の brute-force throttle では「攻撃者が x-forwarded-for を毎回変えて per-IP 上限を回避」する余地を
// 残したくない。そこで login に限り、信頼できる IP ソース(プロキシが付与し、クライアントが詐称できない
// x-real-ip)だけを採用し、無ければ「単一の共有バケット」に倒す。
//
// WHY 単一バケットへのフォールバックが「フェイルセーフ(緩めない)」か:
//   x-real-ip が無い環境(= 信頼できる IP が得られない)では、全 login 試行を 1 つのキーに集約して数える。
//   これは「区別できないなら同一視して厳しく数える」= 攻撃者が IP を詐称しても上限を回避できない側。
//   逆に詐称可能な XFF をキーにすると上限回避を許す(緩める)。よって XFF は login throttle では使わない。
// WHY 主防御ではない: この limiter は in-memory・per-instance のベストエフォート(サーバーレスでは
//   インスタンス境界で甘くなる)。login の主防御は ADMIN_PASSWORD(constant-time 照合)。
//   残存リスク = XFF 詐称は x-real-ip 優先で緩和するが、x-real-ip 自体が無い/偽装可能な構成や
//   分散インスタンスでの集約欠落は残る。完全な耐性は Phase 3 の Auth / 共有レート制限ストアで担保する。
// ⚠️ 後任 AI への警告: ここで x-forwarded-for をキーに足さないこと。詐称可能な値を throttle の根拠にすると
//   per-IP 上限を IP ローテーションで回避され、本 limiter が無力化する。共用 extractIp はスコープ外(変えない)。
const LOGIN_TRUST_FALLBACK_KEY = "untrusted-source";

function loginThrottleIp(request: NextRequest): string {
  const real = request.headers.get("x-real-ip");
  if (real && real.trim() !== "") return real.trim();
  // 信頼できる IP が無い → 詐称可能な XFF には頼らず、単一バケットに集約(フェイルセーフ)。
  return LOGIN_TRUST_FALLBACK_KEY;
}

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

  // 成功: 短命(例 12h)の署名 cookie を発行する。
  const nowSec = Math.floor(Date.now() / 1000);
  const cookieValue = signSession(
    { exp: nowSec + ADMIN_SESSION_TTL_SEC, role: "admin" },
    secret
  );

  const res = noStore(NextResponse.json({ ok: true }));
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: cookieValue,
    httpOnly: true, // JS から読めない(XSS でのトークン窃取を緩和)
    // 本番のみ secure(HTTPS 必須)。開発の http://localhost で cookie が落ちないようにする。
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // CSRF 緩和。Lax なら通常ナビゲーションには付与され、クロスサイト POST には付かない
    path: "/", // /admin と /api/admin の両方で送られるよう全パスに付与
    maxAge: ADMIN_SESSION_TTL_SEC, // ブラウザ側の保持期限。署名内 exp と揃える
  });
  return res;
}
