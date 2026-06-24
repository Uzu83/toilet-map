// /admin の Route Handler 用 HTTP ヘルパ(Next の NextResponse に依存する = adminAuth.ts とは別モジュール)。
//
// WHY adminAuth.ts に置かないか: adminAuth.ts は「副作用なし・I/O なし・Next 依存なしの純関数」に保つ約束がある
//   (proxy/route/test のどこからでも env 非依存で呼べるように)。ここは next/server を import するので分離する。
//
// ── login/logout EXCLUSION NOTE ──
// login と logout は独自の CSRF/origin ハンドリングを持ち、ここの guards を使わない。
//   login: isSameOrigin を guard 前に直接呼ぶ(→ brute-force throttle も前置)。
//   logout: isSameOrigin を直接呼ぶ(cookie 消去のみ = 未認証でも無害。セッション検証不要)。
// どちらも「認証のブートストラップ/クリーンアップ」なので汎用 session ガードが使えない/合わない。

import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/lib/adminAuth";
import { getAdminSession } from "@/lib/adminSession";
import { isUuid } from "@/lib/uuid";

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

// ---------------------------------------------------------------------------
// 読み取り専用ガード(session チェックのみ)
// ---------------------------------------------------------------------------
// WHY READ には CSRF チェックを課さないか:
//   GET は副作用が無い。CSRF は「攻撃サイトが自サイト認証を悪用して"書き込む"」問題であり、
//   読み取り専用エンドポイントには適用しないのが設計書の明示ルール
//   (isSameOrigin は変更系のみに適用 — reviews/route.ts コメント参照)。
//   Origin ヘッダは一部の正規ブラウザ GET ナビゲーションでは付かない場合もあり、
//   GET に CSRF チェックを課すと正規アクセスを誤って弾く危険がある。
//   → session cookie の再検証だけで十分な防御レベルを達成する。
export async function requireAdminRead(): Promise<
  { ok: true } | { ok: false; res: NextResponse }
> {
  // ① 認証 cookie 再検証。proxy をすり抜けてもここが権限の最終根拠。
  const session = await getAdminSession();
  if (!session) {
    return { ok: false, res: noStore(NextResponse.json({ error: "unauthorized" }, { status: 401 })) };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 変更系ガード(session → CSRF/origin → [UUID] の順に検証)
// ---------------------------------------------------------------------------
// 検証順序: ①session(401) → ②CSRF/origin(403) → ③UUID(400, rawId が指定された場合のみ)。
//
// WHY session を origin より先に確認するか:
//   セッションが無い(= 未認証)なら CSRF チェックに至る前に即拒否するほうが処理が安い。
//   また認証失敗(401)と CSRF 失敗(403)を明確に区別してログに残すことで、攻撃種別を判別できる。
//
// WHY UUID 検証を最後(CSRF 後)に行うか:
//   未認証 or 別オリジンのリクエストに対して UUID 検証エラー(400)の情報を返す必要はない。
//   先に session/CSRF で弾いておくことで、有効な「ルート ID の形」情報を攻撃者に与えない。
//
// rawId が渡された場合のみ UUID 検証を行う(analyze のように body バリデーションが別途行われるルートでは
//   rawId を渡さない = UUID ステップはスキップする)。
//
// 戻り値: ok=true のとき id フィールドは rawId が指定された場合のみ含まれる。
export async function requireAdminMutation(
  request: NextRequest,
  rawId?: string,
): Promise<{ ok: true; id?: string } | { ok: false; res: NextResponse }> {
  // ① 認証 cookie 再検証。
  const session = await getAdminSession();
  if (!session) {
    return { ok: false, res: noStore(NextResponse.json({ error: "unauthorized" }, { status: 401 })) };
  }
  // ② CSRF: cookie 認証の変更系なので、自サイト由来かを Origin/Host で確認する(SameSite=Lax と併用)。
  if (!isSameOrigin(request)) {
    return { ok: false, res: noStore(NextResponse.json({ error: "bad origin" }, { status: 403 })) };
  }
  // ③ rawId が指定された場合に限り UUID 検証(不正値で DB に投げない)。
  if (rawId !== undefined) {
    if (!isUuid(rawId)) {
      return { ok: false, res: noStore(NextResponse.json({ error: "invalid id" }, { status: 400 })) };
    }
    return { ok: true, id: rawId };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 共通 RPC エラー → HTTP ステータス マッパー
// ---------------------------------------------------------------------------
// WHY 抽出するか:
//   toilets/[id] と suggestions/[id] が同じパターン(message を substring で照合 → status コード決定)を
//   重複実装していた。マッチング機構を共有化し、各ルートは「自分のエラーテーブル」を渡すだけにする。
//   これにより「新しい RPC エラー理由を追加する」変更が 1 箇所で済む。
//   重要: 各ルートの 409 text は異なる(toilet=newer state exists / suggestion=already processed)ので、
//   clientMessageFor は呼び出し側からルート固有の 409 テキストを渡せるようにする。
//
// table 引数: [substring, status][] の配列。先頭から順に message.includes(substring) を試す。
//   マッチしたらそのステータスを返す。どれにも当たらなければ 500(フェイルセーフ)。
export function rpcStatusFor(
  message: string,
  table: ReadonlyArray<[string, number]>,
): number {
  for (const [substr, status] of table) {
    if (message.includes(substr)) return status;
  }
  // 想定外の RPC エラー(呼び出し側のバグ等)は 500 にフォールバック。
  return 500;
}

// クライアントに返す安全な文言(生 DB 文言は出さない)。
// conflictText: 409 のルート固有テキスト。
//   toilet route: "conflict: newer state exists"
//   suggestions route: "conflict: already processed"
// 両ルートで異なる理由: 409 の文脈が違う(edit タイムスタンプ競合 vs 提案の二重処理)。
//   呼び出し側からテキストを渡すことで、この関数が両ルートのテキストを知る必要をなくす。
export function clientMessageFor(status: number, conflictText = "conflict"): string {
  switch (status) {
    case 404:
      return "not found";
    case 409:
      return conflictText;
    case 400:
      return "invalid value";
    default:
      return "internal error";
  }
}
