// /admin パスキー(WebAuthn)ログインの共通部品(Issue #61)。
//
// 設計の要点:
// - WebAuthn の暗号処理は自前で書かず @simplewebauthn/server に任せる。ここは env・challenge・cookie の扱いだけ。
// - 管理者は社長 1 人。ユーザー表は持たず、登録済みパスキー(admin_passkeys)のどれかで署名できれば admin。
// - ログイン成功後は既存の署名 cookie セッション(adminAuth.signSession)をそのまま発行する。
// - challenge は DB(admin_webauthn_challenges)に置き、検証時に DELETE ... RETURNING で取り出す。
//   WHY cookie だけにしないか: cookie に challenge を入れるだけでは「同じ challenge と応答の組」を
//   期限内に何度でも再送できる。DB から消して取り出せば 1 回しか使えない(サーバーレスでも共有される)。
//   cookie には challenge 行の id(推測不能な uuid)だけを入れる。

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { isUuid } from "@/lib/uuid";

export const PASSKEY_TABLE = "admin_passkeys";
export const CHALLENGE_TABLE = "admin_webauthn_challenges";

// challenge 行の id を入れる cookie。パスキー API にしか送らない(path)。
export const WEBAUTHN_CHALLENGE_COOKIE = "loomap_admin_webauthn";
const CHALLENGE_COOKIE_PATH = "/api/admin/passkey";

// challenge の有効期限 = 5 分。ブラウザの WebAuthn ダイアログを操作するのに十分で、放置された challenge は早く消える。
export const WEBAUTHN_CHALLENGE_TTL_SEC = 5 * 60;

export const WEBAUTHN_RP_NAME = "Loo map 管理";
// 管理者は 1 人なので固定の user handle を使う(同じ端末で登録し直すと上書きされる)。
export const ADMIN_WEBAUTHN_USER_NAME = "admin";
export const ADMIN_WEBAUTHN_USER_ID = new Uint8Array(Buffer.from("loomap-admin", "utf8"));

export type ChallengePurpose = "registration" | "authentication";

export type PasskeyEnv = {
  rpID: string;
  origin: string;
  secret: string;
};

// env を読む。未設定・不正ならフェイルクローズ(呼び出し側が 503 にする)。値そのものはログに出さない。
// ADMIN_WEBAUTHN_RP_ID: 例 loomap.jp(ドメインだけ。スキームやポートは付けない)
// ADMIN_WEBAUTHN_ORIGIN: 例 https://loomap.jp(管理画面を開く origin。末尾スラッシュなし)
export function readPasskeyEnv():
  | { ok: true; env: PasskeyEnv }
  | { ok: false; missing: string[] } {
  const rpID = (process.env.ADMIN_WEBAUTHN_RP_ID ?? "").trim();
  const origin = (process.env.ADMIN_WEBAUTHN_ORIGIN ?? "").trim();
  const secret = process.env.ADMIN_SESSION_SECRET ?? "";
  const missing: string[] = [];
  if (rpID.length === 0) missing.push("ADMIN_WEBAUTHN_RP_ID");
  if (origin.length === 0) missing.push("ADMIN_WEBAUTHN_ORIGIN");
  if (secret.length === 0) missing.push("ADMIN_SESSION_SECRET");
  if (missing.length > 0) return { ok: false, missing };
  if (!isOriginForRpId(origin, rpID)) return { ok: false, missing: ["ADMIN_WEBAUTHN_ORIGIN(invalid)"] };
  return { ok: true, env: { rpID, origin, secret } };
}

// origin が「スキーム+ホスト(+ポート)だけ」で、そのホストが rpID と同じかサブドメインかを確かめる。
export function isOriginForRpId(origin: string, rpID: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false; // パスや末尾スラッシュ付きは不可
  const host = url.hostname;
  return host === rpID || host.endsWith(`.${rpID}`);
}

export function isChallengeExpired(expiresAt: string, nowMs: number): boolean {
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return true; // 読めない期限は期限切れ扱い(フェイルクローズ)
  return nowMs >= t;
}

// challenge を保存して行 id を返す。失敗時は null。
// ついでに期限切れの行を消す(放置された challenge で表が膨らまないように)。
export async function saveChallenge(
  supabase: SupabaseClient,
  purpose: ChallengePurpose,
  challenge: string,
  nowMs: number,
): Promise<string | null> {
  const nowIso = new Date(nowMs).toISOString();
  const { error: cleanupErr } = await supabase.from(CHALLENGE_TABLE).delete().lt("expires_at", nowIso);
  if (cleanupErr) {
    // 掃除の失敗はログだけ(ログイン自体は続けられる)。
    console.warn("[adminPasskey] challenge cleanup failed", { code: cleanupErr.code });
  }
  const expiresAt = new Date(nowMs + WEBAUTHN_CHALLENGE_TTL_SEC * 1000).toISOString();
  const { data, error } = await supabase
    .from(CHALLENGE_TABLE)
    .insert({ purpose, challenge, expires_at: expiresAt })
    .select("id")
    .single();
  if (error || !data || typeof (data as { id?: unknown }).id !== "string") {
    console.error("[adminPasskey] challenge insert failed", { code: error?.code });
    return null;
  }
  return (data as { id: string }).id;
}

// challenge を 1 回だけ取り出す。行は必ず消す(期限切れでも)。無効なら null。
export async function consumeChallenge(
  supabase: SupabaseClient,
  id: string | undefined,
  purpose: ChallengePurpose,
  nowMs: number,
): Promise<string | null> {
  if (!id || !isUuid(id)) return null;
  const { data, error } = await supabase
    .from(CHALLENGE_TABLE)
    .delete()
    .eq("id", id)
    .eq("purpose", purpose)
    .select("challenge, expires_at");
  if (error) {
    console.error("[adminPasskey] challenge consume failed", { code: error.code });
    return null;
  }
  const rows = (data ?? []) as Array<{ challenge?: unknown; expires_at?: unknown }>;
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (typeof row.challenge !== "string" || typeof row.expires_at !== "string") return null;
  if (isChallengeExpired(row.expires_at, nowMs)) return null;
  return row.challenge;
}

export function setChallengeCookie(res: NextResponse, id: string): void {
  res.cookies.set({
    name: WEBAUTHN_CHALLENGE_COOKIE,
    value: id,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: CHALLENGE_COOKIE_PATH,
    maxAge: WEBAUTHN_CHALLENGE_TTL_SEC,
  });
}

export function clearChallengeCookie(res: NextResponse): void {
  res.cookies.set({
    name: WEBAUTHN_CHALLENGE_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: CHALLENGE_COOKIE_PATH,
    maxAge: 0,
  });
}

// クライアントから来た WebAuthn 応答 JSON の最低限の形チェック(中身の検証はライブラリが行う)。
export function looksLikeCredentialResponse(
  body: unknown,
): body is { id: string; rawId: string; type: string; response: Record<string, unknown> } {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.id === "string" &&
    b.id.length > 0 &&
    b.id.length <= 1024 &&
    typeof b.rawId === "string" &&
    b.type === "public-key" &&
    typeof b.response === "object" &&
    b.response !== null
  );
}
