// /admin の「サーバ側セッション再検証」ヘルパ(I/O あり = next/headers の cookies を読む)。
//
// WHY adminAuth.ts と分けるか: adminAuth.ts は「副作用なし・env を読まない純関数」に保つ約束がある
//   (proxy/route/test のどこからでも同じロジックを呼べるように)。一方こちらは cookies()(request-time API)
//   と process.env を触る = 副作用あり。役割を分離して純関数モジュールを汚さない。
//
// 多層防御: proxy(early gate)で弾いた上で、admin ページ/API でも必ずこの関数で cookie を再検証する。
//   proxy は matcher 変更や配備最適化で被覆が外れうるため、権限の最終根拠にしない(Next 公式の注意)。

import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySession, type SessionPayload } from "@/lib/adminAuth";

// Server Component / Route Handler から呼ぶ。認証済みなら payload、未認証なら null。
// secret 未設定(フェイルクローズ)・cookie 無し・改ざん・期限切れはすべて null。
export async function getAdminSession(): Promise<SessionPayload | null> {
  // ADMIN_SESSION_SECRET 未設定なら verifySession が null を返す(フェイルクローズ)。
  const secret = process.env.ADMIN_SESSION_SECRET ?? "";
  // cookies() は Next16 では async。await して cookie ストアを得る。
  const store = await cookies();
  const cookieValue = store.get(ADMIN_COOKIE_NAME)?.value;
  const nowSec = Math.floor(Date.now() / 1000);
  return verifySession(cookieValue, secret, nowSec);
}
