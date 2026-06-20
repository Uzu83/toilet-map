// /admin の Route Handler 用 HTTP ヘルパ(Next の NextResponse に依存する = adminAuth.ts とは別モジュール)。
//
// WHY adminAuth.ts に置かないか: adminAuth.ts は「副作用なし・I/O なし・Next 依存なしの純関数」に保つ約束がある
//   (proxy/route/test のどこからでも env 非依存で呼べるように)。ここは next/server を import するので分離する。

import type { NextResponse } from "next/server";

// 管理系レスポンスに Cache-Control: no-store, private を付ける。
// WHY: 設計書は admin ページ/API を「no-store でキャッシュさせない」と定めるが、
//   export const dynamic = "force-dynamic" は Next 自身の static 生成/Full Route Cache を抑止するだけで、
//   ブラウザ/CDN/中間プロキシ向けの Cache-Control ヘッダは出さない。/admin の HTML や GET /api/admin/reviews の
//   JSON には非公開のモデレーション情報(レビューコメント等)が載るため、共有端末の bfcache/ディスクキャッシュに
//   認証済みコンテンツが残らないよう no-store を「実体化」する。
//   (Server Component ページ側は next.config の headers() で /admin/:path* に一括付与する。)
export function noStore<T extends NextResponse>(res: T): T {
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}
