// /admin モデレーション(Phase A)の「認証スパイン」= 純粋関数だけを集めたモジュール。
//
// 設計の要点(docs/progress/PROGRESS-admin-ai.md の確定方針):
// - 認証は env 共有パスワード + 署名 cookie(ステートレス)。ソロ運用「最初だけ手動」に最小コスト。
//   sessions テーブルを持たない代わりに、HMAC-SHA256 で payload を署名し改ざんを検知する。
// - ここは「副作用なし・I/O なし」の純関数のみに保つ(WHY: proxy / route / test のどこからでも
//   同じロジックを呼べるようにし、テストでは secret をローカルに渡して実 env 非依存にするため)。
//   env を読むのは呼び出し側(route)であって、このモジュールではない。
// - 失効はステートレスゆえ個別 revoke 不可。ADMIN_SESSION_SECRET をローテーションすれば
//   過去の全署名が検証不能になり「全セッション一括失効」になる(漏洩・端末紛失時の対処)。
//
// 命名: cookie 値のフォーマットは `base64url(payloadJson).base64url(HMAC)`。

import { createHmac, timingSafeEqual } from "node:crypto";
import { ACCESS_SET } from "@/types/toilet";

// ---------------------------------------------------------------------------
// 編集 allowlist(toilets テーブルの「admin が更新してよい実カラム」)
// ---------------------------------------------------------------------------
// WHY allowlist 方式: PATCH のボディを素通しで UPDATE に流すと、攻撃者(または将来のバグ)が
//   source / dominant_access のような「変えてはいけない列」を書き換えられてしまう。
//   許可列を allowlist で固定し、未知キーは「拒否」することで改ざん面を最小化する。
// WHY dominant_access を含めない: reviews 集計ビュー由来で UPDATE 不可(計算列)。
// WHY source を含めない: CHECK 制約(osm/user/inferred)で固定。admin が source を書き換える正当な理由がない。
export const EDITABLE_FIELDS = [
  "name",
  "inferred_access",
  "has_washlet",
  "has_diaper_table",
  "is_universal",
  "opening_hours",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

// 文字列列の長さ上限(DoS / 想定外肥大の抑止)。name は表示名相当、opening_hours は OSM 形式の式。
// WHY export: aiSuggestion.ts が同じ上限を独自に宣言していたが「同値を保つ」コメントで管理していた。
// 単一定義に統合し、将来どちらか片方だけ変える誤りを構造的に防ぐ。
export const MAX_NAME_LEN = 120;
export const MAX_OPENING_HOURS_LEN = 200;

// validateEdit が返す「正規化済みパッチ」。boolean 列は null 可(= 不明)を許容する。
export type ValidatedEdit = Partial<{
  name: string | null;
  inferred_access: "open" | "ask" | "permission";
  has_washlet: boolean | null;
  has_diaper_table: boolean | null;
  is_universal: boolean | null;
  opening_hours: string | null;
}>;

export class AdminEditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminEditValidationError";
  }
}

// 受け取った patch を allowlist で検証し、正規化済みパッチを返す。
// 不正があれば AdminEditValidationError を throw する(呼び出し側で 400 にする)。
//
// WHY throw 方式: 「拒否」を握り潰して空 UPDATE が成立するより、明確に失敗させるほうが安全。
//   未知キーは「無視」ではなく「拒否」する(設計書: source・未知キーは拒否)。
export function validateEdit(patch: unknown): ValidatedEdit {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new AdminEditValidationError("patch must be an object");
  }
  const input = patch as Record<string, unknown>;

  // 未知キー(allowlist 外)が 1 つでもあれば拒否する。
  // WHY: 黙って無視すると「source を送ったのに通った(ように見える)」混乱や、
  //   将来 allowlist に列を足したときの取りこぼしを招く。明示的に弾く。
  const allowed = new Set<string>(EDITABLE_FIELDS);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new AdminEditValidationError(`field not allowed: ${key}`);
    }
  }

  const out: ValidatedEdit = {};

  if ("name" in input) {
    const v = input.name;
    if (v === null) {
      out.name = null;
    } else if (typeof v === "string") {
      if (v.length > MAX_NAME_LEN) {
        throw new AdminEditValidationError("name too long");
      }
      out.name = v;
    } else {
      throw new AdminEditValidationError("name must be string or null");
    }
  }

  if ("opening_hours" in input) {
    const v = input.opening_hours;
    if (v === null) {
      out.opening_hours = null;
    } else if (typeof v === "string") {
      if (v.length > MAX_OPENING_HOURS_LEN) {
        throw new AdminEditValidationError("opening_hours too long");
      }
      out.opening_hours = v;
    } else {
      throw new AdminEditValidationError("opening_hours must be string or null");
    }
  }

  if ("inferred_access" in input) {
    const v = input.inferred_access;
    // enum 検証。null は許容しない(access は色決定の根拠なので、消すなら別 UX を用意する)。
    if (typeof v !== "string" || !ACCESS_SET.has(v as "open" | "ask" | "permission")) {
      throw new AdminEditValidationError("inferred_access must be one of open/ask/permission");
    }
    out.inferred_access = v as "open" | "ask" | "permission";
  }

  for (const boolField of ["has_washlet", "has_diaper_table", "is_universal"] as const) {
    if (boolField in input) {
      const v = input[boolField];
      // boolean か null(= 不明)のみ許容。"true" 等の文字列は拒否(型の取り違えを早期に検出)。
      if (v !== null && typeof v !== "boolean") {
        throw new AdminEditValidationError(`${boolField} must be boolean or null`);
      }
      out[boolField] = v;
    }
  }

  // 空 patch(有効な列が 1 つも無い)は無意味な UPDATE になるので拒否する。
  if (Object.keys(out).length === 0) {
    throw new AdminEditValidationError("no editable fields in patch");
  }

  return out;
}

// ---------------------------------------------------------------------------
// constant-time 比較
// ---------------------------------------------------------------------------
// timingSafeEqual は「同じ長さのバッファ」しか受け付けず、長さが違うと throw する。
// そのまま使うと「長さの違いが例外という形でタイミング差/エラー差になる」ため、
// 長さガードを自前で噛ませる。
//
// WHY 長さ不一致でも例外にせず false を返す: 呼び出し側が try/catch を都度書かなくてよくし、
//   かつ「長さが違う = 不一致」という当然の結論を一様に返すため。
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // 長さが違えば即不一致。ここでの早期 return は「長さ」という非秘密の情報しか漏らさない
  // (HMAC や正解パスワードは固定長 or 攻撃者が事前に知り得ない長さなので問題にならない)。
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// パスワード照合。env の正解値(expected)と入力(input)を constant-time 比較する。
// WHY 専用関数にする: 呼び出し側が誤って `===` で比較するのを防ぎ、意図(タイミング安全)を明示する。
export function checkPassword(input: string, expected: string): boolean {
  // 空の expected は「未設定相当」。誤って空文字を正解にしてしまうと誰でも通るので false 固定。
  if (expected.length === 0) return false;
  return constantTimeEqual(input, expected);
}

// ---------------------------------------------------------------------------
// セッション署名 / 検証(ステートレス)
// ---------------------------------------------------------------------------
// cookie 値 = `base64url(payloadJson)` + "." + `base64url(HMAC-SHA256(payloadJson, secret))`
// payload には必ず exp(有効期限の epoch 秒)を含める。

export type SessionPayload = {
  // 有効期限(epoch 秒)。verifySession で nowSec と比較する。
  exp: number;
  // 識別用の任意フィールド。Phase A は単一管理者なので最小限(role 程度)。
  role?: string;
  [key: string]: unknown;
};

function base64urlEncode(buf: Buffer): string {
  // Node の "base64url" エンコーディングは padding 無し・URL safe。cookie に安全に載る。
  return buf.toString("base64url");
}

function hmac(payloadB64: string, secret: string): Buffer {
  // 署名対象は base64url 済みの payload 文字列そのもの(検証時と完全一致させるため)。
  return createHmac("sha256", secret).update(payloadB64).digest();
}

// payload を署名して cookie 値を作る。secret はここで受け取る(env はモジュール内で読まない)。
export function signSession(payload: SessionPayload, secret: string): string {
  if (secret.length === 0) {
    // フェイルクローズ: secret 未設定で署名すると HMAC が空鍵になり危険。明示的に失敗させる。
    throw new Error("ADMIN_SESSION_SECRET is empty");
  }
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sigB64 = base64urlEncode(hmac(payloadB64, secret));
  return `${payloadB64}.${sigB64}`;
}

// cookie 値を検証する。署名が正しく exp 未超過なら payload を返す。無効なら null。
//
// 検証順序: ①フォーマット → ②署名(constant-time)→ ③payload パース → ④exp。
// WHY 署名検証を payload パースより先に行う: 改ざんされた(=署名が合わない)入力の JSON を
//   先にパースして判断材料にしない。署名が通ったものだけを「信頼できるデータ」として扱う。
export function verifySession(
  cookieValue: string | undefined | null,
  secret: string,
  nowSec: number
): SessionPayload | null {
  // フェイルクローズ: secret 未設定なら一切信頼しない(= 全員未認証扱い)。
  if (!secret || secret.length === 0) return null;
  if (!cookieValue) return null;

  const dot = cookieValue.indexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return null; // 形式不正
  const payloadB64 = cookieValue.slice(0, dot);
  const sigB64 = cookieValue.slice(dot + 1);

  // 期待する署名を再計算し、提示された署名と constant-time 比較する。
  const expectedSig = base64urlEncode(hmac(payloadB64, secret));
  if (!constantTimeEqual(expectedSig, sigB64)) return null;

  // ここに到達した = 署名が一致 = payload は当方が発行したもの。安心して JSON パースする。
  let payload: SessionPayload;
  try {
    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    payload = parsed as SessionPayload;
  } catch {
    return null;
  }

  // exp 検証。exp が無い / 数値でない / 期限切れは無効。
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
  if (nowSec >= payload.exp) return null;

  return payload;
}

// ---------------------------------------------------------------------------
// CSRF: 同一オリジン判定
// ---------------------------------------------------------------------------
// cookie 認証は CSRF に弱いので、変更系(POST/PATCH)では SameSite=Lax に加えて
// Origin/Host の一致も確認する(多層防御)。
//
// 判定方針:
//  - Origin ヘッダがあれば、その host が Host ヘッダ(= 自サイト)と一致するかを見る(最も確実)。
//  - Origin が無い場合は Referer の origin で代替する。
//  - どちらも無い場合は false(= 同一オリジンと断定できない)を返し、呼び出し側で拒否する。
//    WHY false(deny)を既定にする: 「不明なら通す」より「不明なら弾く」のほうが CSRF に安全。
//    ただし一部の正規 GET ナビゲーションには Origin が付かないため、この関数は
//    「変更系リクエストにのみ」適用する想定(GET には適用しない)。
export function isSameOrigin(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false; // Host 不明では比較できない → deny

  const origin = request.headers.get("origin");
  const candidate = origin ?? request.headers.get("referer");
  if (!candidate) return false; // Origin も Referer も無い → 断定不能 → deny

  try {
    const url = new URL(candidate);
    // host には port が含まれることがある(例 localhost:3000)。URL.host も port を含むので直接比較できる。
    return url.host === host;
  } catch {
    return false; // パース不能な値 → deny
  }
}

// ---------------------------------------------------------------------------
// env フェイルクローズ用ヘルパ
// ---------------------------------------------------------------------------
// ADMIN_PASSWORD / ADMIN_SESSION_SECRET が未設定なら「設定不備」を表す状態を返す。
// 呼び出し側(route / proxy)はこの状態を見て deny(503/401, ログインさせない)を選ぶ。
//
// WHY ここでは env を「読むだけ」にし throw しない: proxy はリクエスト毎に走るため、
//   未設定時に例外で全リクエストを落とすのではなく、呼び出し側が穏当に拒否できるようにする。
// WHY 値そのものは返さない(設定の有無だけ): 秘密値をうっかりログ/レスポンスに乗せないため。
export type AdminEnv = {
  password: string;
  secret: string;
};

export function readAdminEnv(): { ok: true; env: AdminEnv } | { ok: false; missing: string[] } {
  const password = process.env.ADMIN_PASSWORD ?? "";
  const secret = process.env.ADMIN_SESSION_SECRET ?? "";
  const missing: string[] = [];
  if (password.length === 0) missing.push("ADMIN_PASSWORD");
  if (secret.length === 0) missing.push("ADMIN_SESSION_SECRET");
  if (missing.length > 0) return { ok: false, missing };
  // WHY 値を返すのは route 用(署名/照合に要る)。ログには出さない運用を呼び出し側で徹底する。
  return { ok: true, env: { password, secret } };
}

// cookie 名(proxy / login route / 各 admin route で共有する単一の真実)。
// WHY 1 箇所定数化: proxy が読む cookie 名と login route が set する cookie 名・logout route が消す
//   cookie 名がズレると「ログインしたのに毎回弾かれる/ログアウトできない」沈黙バグになる。
//   3 ファイルが同じこの定数を import することで名前ズレを構造的に不可能にする(ハードコード文字列を散らさない)。
export const ADMIN_COOKIE_NAME = "loomap_admin";

// セッション有効期限(秒)= 12 時間。署名 cookie の payload.exp とブラウザ側 maxAge の両方に使う(login route)。
// ───────────────────────────────────────────────────────────────────
// なぜ「12h」か(短すぎ ↔ 長すぎ のトレードオフ。後任 AI が安易に伸ばさないための根拠)
// ───────────────────────────────────────────────────────────────────
//  - 短すぎる(例 1h): cookie 失効のたびに再ログインを強いられ、運営作業(レビュー精査 → 編集)の途中で
//    締め出される。ソロ運営ツールでこれは純粋な邪魔(可用性の毀損)。
//  - 長すぎる(例 30d): 端末紛失・cookie 漏洩時に攻撃者が admin を操作できる「露出窓」がそのまま 30 日に広がる。
//  - 12h ≒ 「1 日の作業セッション中は再ログイン不要」かつ「翌日には自然失効していて寝ている間の露出窓が短い」
//    の妥協点。設計書(PROGRESS §Phase A)の例 12h を採用。
// ───────────────────────────────────────────────────────────────────
// ⚠️⚠️ 後任 AI への警告(失効戦略とセットでしか伸ばせない):
//   このセッションは「ステートレス署名 cookie」= サーバ側に session テーブルを持たない。よって exp 到来前に
//   「特定の 1 セッションだけを個別 revoke する」手段は存在しない(verifySession は署名と exp しか見ない)。
//   漏洩・端末紛失時の唯一の失効手段は ADMIN_SESSION_SECRET のローテーション = 過去の全署名を一括で無効化
//   (= 運営者本人も巻き込む全ログアウト)。logout route は当該ブラウザの cookie を消すだけで、盗まれた
//   cookie 値そのものは exp まで有効なまま(サーバは個別に無効化できない)。
//   したがって TTL を伸ばすと「漏れた cookie が有効なままの時間」が比例して伸びる。伸ばすなら
//   「個別 revoke を可能にする stateful セッション(jti を DB で失効管理 等)」への移行とセットで行うこと。
//   単独で日数に伸ばすのは露出窓の一方的な拡大であり、しない。
export const ADMIN_SESSION_TTL_SEC = 12 * 60 * 60;
