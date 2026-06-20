import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { ADMIN_COOKIE_NAME, verifySession } from "@/lib/adminAuth";

// next-intl のルーティング(/en /ko /zh のプレフィックス付与等)。/admin 系以外は従来通りこれに流す。
const intlMiddleware = createMiddleware(routing);

// proxy(Next16 の旧 middleware)は「早期ゲート」専用。
// WHY 権限の最終根拠にしない: proxy は CDN/Edge 側に最適化配備されたり、matcher 変更や
//   Server Function のルート移動で被覆が外れる可能性がある(Next 公式の data-security 注意)。
//   よって各 admin ページ/API でも cookie を必ず再検証する(多層防御)。ここは「明らかな未認証を
//   早めに弾く + locale 付与を回避する」ためだけに使う。
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdminApi = pathname === "/api/admin" || pathname.startsWith("/api/admin/");

  if (isAdminPage || isAdminApi) {
    // ログイン導線は認証の例外。ここを保護するとログイン不能(自己ロックアウト)になる。
    // - GET /admin/login(ログインフォーム)
    // - POST /api/admin/login(資格情報の送信先)
    // ⚠️⚠️ 地雷: この 2 つを下の cookie ゲートに通すと「未認証 → ログイン画面/login API へリダイレクト/401」が
    //    ログイン画面/login API 自身にも適用され、cookie を取得する手段が永久に塞がれる(=誰もログインできない
    //    死のループ)。後任 AI へ: 「全 /admin を一律に保護したい」と思っても、この 2 つは絶対に例外から外さない。
    //    login API を例外から外すと「正しいパスワードを送っても 401 で弾かれて cookie が発行されない」状態になる。
    // WHY login API は method 不問で素通し: GET でアクセスされても 405 を route 側が返せばよく、
    //   proxy で method 判定まで持つと複雑になる。認証は各 route で再検証するので安全側は保たれる。
    const isLoginPage = pathname === "/admin/login";
    const isLoginApi = pathname === "/api/admin/login";
    if (isLoginPage || isLoginApi) {
      return NextResponse.next();
    }

    // cookie を検証。secret 未設定(フェイルクローズ)・改ざん・期限切れはすべて null になり未認証扱い。
    // WHY env をここで読む: proxy は Node.js runtime で走る(Next16 既定)ので process.env を参照できる。
    const cookie = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const secret = process.env.ADMIN_SESSION_SECRET ?? "";
    const nowSec = Math.floor(Date.now() / 1000);
    const session = verifySession(cookie, secret, nowSec);

    if (!session) {
      if (isAdminApi) {
        // API は JSON 401(リダイレクトしてもクライアントが扱いにくい)。
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      // ページはログイン画面へ。next で戻り先を渡しておく(ログイン後に元の場所へ戻す用、任意)。
      const loginUrl = new URL("/admin/login", request.url);
      if (pathname !== "/admin/login") {
        loginUrl.searchParams.set("next", pathname);
      }
      return NextResponse.redirect(loginUrl);
    }

    // 認証済み。/admin 系は next-intl に流さない(locale プレフィックスを付けない・[locale] 配下でもない)。
    return NextResponse.next();
  }

  // /admin 系以外は従来通り next-intl に委譲する(i18n ルーティング/リダイレクトを壊さない)。
  return intlMiddleware(request);
}

export const config = {
  // matcher に admin 系を明示追加する。
  // 1) 既存の i18n matcher: /api, /_next, /_vercel, ファイル(ドット含む)を除外。
  //    → この除外があるため、これ単体では /api/admin/* に proxy が走らない。だから 2) を足す。
  // 2) /admin/:path*(/admin 直下含む)と /api/admin/:path* を明示的に対象化。
  // ⚠️ 地雷: 2) の `/api/admin/:path*` を消す(または 1) の `?!api` を緩める)と、API 側の早期ゲートが
  //    静かに無効化される。proxy は「権限の最終根拠ではない」(各 route で再検証する多層防御)ので
  //    地図機能は壊れないが、早期 401 が消えて未認証リクエストが route 本体まで到達するようになる。
  //    被覆を狭めるときは、対応する route の cookie 再検証(getAdminSession)が確実に効いていることを必ず確認する。
  matcher: [
    "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
    "/admin/:path*",
    "/api/admin/:path*",
  ],
};
