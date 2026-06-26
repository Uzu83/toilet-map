// 共通 admin route テストヘルパ。
//
// WHY 抽出するか: toilets/[id]・suggestions/[id]・analyze の 3 テストファイルが同一のモックボイラープレートを
//   コピーしていた。vi.mock() を複数ファイルに書いても vitest は「テストファイル単位でモジュールグラフを隔離」
//   するため副作用は出ないが、変更が 1 箇所に集まることでメンテナンスコストが下がる。
//   また「ヘルパを変えると全テストに影響が及ぶ」構造により、モック誤りを見逃しにくくなる。
//
// ⚠️ vi.mock() の factory を外部モジュールから渡すと vitest のホイスティングで「初期化前参照エラー」になる。
//   各テストファイルでは vi.mock("@/lib/adminSession", () => ({ getAdminSession: () => getAdminSessionMock() }))
//   のようにインライン factory を書きつつ、getAdminSessionMock だけをここから import して使う。

import { vi } from "vitest";
import { NextRequest } from "next/server";

// ── adminSession モック ──────────────────────────────────────────────────────
// getAdminSession をモックして、テストごとに「認証済み/未認証」を切り替える。
// デフォルト: 認証済み({ exp: 9_999_999_999, role: "admin" })。未認証テストで null を返す。
export const getAdminSessionMock = vi.fn();

// ── Supabase server モック ───────────────────────────────────────────────────
// 各テストファイルは自分の rpc/from モックが必要なため、汎用の factory は提供しない。
// ここでは「getServerSupabaseSecret が呼ばれるモジュールを mock する」ための枠だけ用意し、
// 実際の makeSupabase() 実装は各テストファイルが定義して渡す形にする。
//
// WHY 実装をここに置かないか: toilets route は rpc() のみ、suggestions は rpc() + from().update()、
//   analyze は from() を複数テーブルで分岐する。共通 shape にできない。

// ── NextRequest ファクトリ ────────────────────────────────────────────────────
// loomap.test = 同一オリジン、evil.test = 別オリジン。

export type RequestOptions = {
  method?: string;
  sameOrigin?: boolean;
  body?: unknown;
  url?: string;
};

// 汎用リクエストファクトリ(全 admin テストで使える)。
export function makeAdminRequest(opts: RequestOptions = {}): NextRequest {
  const {
    method = "POST",
    sameOrigin = true,
    body,
    url = "https://loomap.test/api/admin/test",
  } = opts;
  const headers: Record<string, string> = {
    host: "loomap.test",
    origin: sameOrigin ? "https://loomap.test" : "https://evil.test",
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined
      ? (typeof body === "string" ? body : JSON.stringify(body))
      : undefined,
  });
}

// ── セッションモックのリセットヘルパ ─────────────────────────────────────────
// 各テストファイルの beforeEach で呼ぶ。
export function resetAdminSession() {
  getAdminSessionMock.mockReturnValue({ exp: 9_999_999_999, role: "admin" });
}
