import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, isSameOrigin } from "@/lib/adminAuth";
import { noStore } from "@/lib/adminHttp";

// secret は読まない(cookie を消すだけ)が、admin サブツリーの runtime を揃えるため Node 固定。
export const runtime = "nodejs";
// 管理系は静的化・キャッシュさせない(layout/login と同方針)。
export const dynamic = "force-dynamic";

// POST /api/admin/logout — この端末のセッション cookie を即時失効させる。
//
// WHY 個別ログアウトが要るか: セッションはステートレス署名 cookie(exp=12h)で、設計の失効手段は
//   ADMIN_SESSION_SECRET ローテーション(= 全セッション一括失効)のみ。これは運用者本人も巻き込む重い操作で、
//   「端末紛失・共有端末」のときに「その端末のセッションだけ穏当に終わらせる」軽量な導線が無かった。
//   cookie は httpOnly なのでクライアント JS では消せない → サーバが Set-Cookie で上書き削除する必要がある。
// WHY proxy の認証例外に入れていない: logout は cookie を消すだけで未認証でも無害(冪等)。
//   ただし他人サイトからの強制ログアウト(軽微な CSRF)を避けるため同一オリジンは確認する。
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return noStore(NextResponse.json({ error: "bad origin" }, { status: 403 }));
  }

  const res = noStore(NextResponse.json({ ok: true }));
  // 発行時(login route)と同じ属性で maxAge:0 上書き = 即時削除。
  //   属性が食い違うと一部ブラウザが別 cookie とみなして消えないので、login と揃える。
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
