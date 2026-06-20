import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AdminEditValidationError,
  checkPassword,
  constantTimeEqual,
  isSameOrigin,
  signSession,
  validateEdit,
  verifySession,
  type SessionPayload,
} from "@/lib/adminAuth";

// 秘密値はテスト内でローカルに渡す(実 env 非依存)。これにより env 無しでも CI が緑になる。
const SECRET = "test-secret-do-not-use-in-prod";

// 固定の「現在時刻」(epoch 秒)。exp 比較を決定的にする。
const NOW = 1_700_000_000;

describe("signSession / verifySession", () => {
  it("ラウンドトリップ: sign したものを verify すると payload が戻る", () => {
    const payload: SessionPayload = { exp: NOW + 3600, role: "admin" };
    const cookie = signSession(payload, SECRET);
    const out = verifySession(cookie, SECRET, NOW);
    expect(out).not.toBeNull();
    expect(out?.role).toBe("admin");
    expect(out?.exp).toBe(NOW + 3600);
  });

  it("改ざん検知: payload を書き換えると署名が合わず null", () => {
    const cookie = signSession({ exp: NOW + 3600 }, SECRET);
    const [payloadB64, sig] = cookie.split(".");
    // payload を別物にすり替える(role を勝手に付与した攻撃を模す)。
    const forgedPayload = Buffer.from(
      JSON.stringify({ exp: NOW + 3600, role: "superadmin" }),
      "utf8"
    ).toString("base64url");
    expect(payloadB64).not.toBe(forgedPayload);
    const forged = `${forgedPayload}.${sig}`;
    expect(verifySession(forged, SECRET, NOW)).toBeNull();
  });

  it("署名改ざん検知: 署名部分を書き換えると null", () => {
    const cookie = signSession({ exp: NOW + 3600 }, SECRET);
    const [payloadB64] = cookie.split(".");
    const forged = `${payloadB64}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(verifySession(forged, SECRET, NOW)).toBeNull();
  });

  it("別 secret では検証に失敗する(= secret ローテーションで一括失効)", () => {
    const cookie = signSession({ exp: NOW + 3600 }, SECRET);
    expect(verifySession(cookie, "rotated-secret", NOW)).toBeNull();
  });

  it("exp 期限切れ: now >= exp なら null", () => {
    const cookie = signSession({ exp: NOW }, SECRET); // exp == now → 期限切れ扱い
    expect(verifySession(cookie, SECRET, NOW)).toBeNull();
    const cookie2 = signSession({ exp: NOW - 1 }, SECRET);
    expect(verifySession(cookie2, SECRET, NOW)).toBeNull();
  });

  it("exp 有効: now < exp なら通る", () => {
    const cookie = signSession({ exp: NOW + 1 }, SECRET);
    expect(verifySession(cookie, SECRET, NOW)).not.toBeNull();
  });

  it("フォーマット不正(ドット無し / 空)は null", () => {
    expect(verifySession("not-a-cookie", SECRET, NOW)).toBeNull();
    expect(verifySession("", SECRET, NOW)).toBeNull();
    expect(verifySession(undefined, SECRET, NOW)).toBeNull();
    expect(verifySession(null, SECRET, NOW)).toBeNull();
    expect(verifySession(".sig", SECRET, NOW)).toBeNull();
    expect(verifySession("payload.", SECRET, NOW)).toBeNull();
  });

  it("フェイルクローズ: secret 未設定(空)なら検証は常に null", () => {
    const cookie = signSession({ exp: NOW + 3600 }, SECRET);
    expect(verifySession(cookie, "", NOW)).toBeNull();
  });

  it("exp 欠落の payload は null(署名が合っても拒否)", () => {
    // exp 無しの payload を手で署名して、verify が exp 欠落で弾くことを確認。
    const payloadB64 = Buffer.from(JSON.stringify({ role: "admin" }), "utf8").toString(
      "base64url"
    );
    const sig = createHmac("sha256", SECRET).update(payloadB64).digest().toString("base64url");
    const cookie = `${payloadB64}.${sig}`;
    expect(verifySession(cookie, SECRET, NOW)).toBeNull();
  });
});

describe("constantTimeEqual", () => {
  it("同一文字列は true", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
  });
  it("異なる文字列は false", () => {
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
  });
  it("長さ違いは throw せず false", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "x")).toBe(false);
  });
  it("空文字どうしは true", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("checkPassword", () => {
  it("一致で true", () => {
    expect(checkPassword("hunter2", "hunter2")).toBe(true);
  });
  it("不一致で false", () => {
    expect(checkPassword("wrong", "hunter2")).toBe(false);
  });
  it("expected が空(未設定相当)なら常に false", () => {
    expect(checkPassword("", "")).toBe(false);
    expect(checkPassword("anything", "")).toBe(false);
  });
});

describe("validateEdit — allowlist 強制", () => {
  it("正常: allowlist 列が正しく通る", () => {
    const out = validateEdit({
      name: "公園トイレ",
      inferred_access: "open",
      has_washlet: true,
      has_diaper_table: false,
      is_universal: null,
      opening_hours: "24/7",
    });
    expect(out).toEqual({
      name: "公園トイレ",
      inferred_access: "open",
      has_washlet: true,
      has_diaper_table: false,
      is_universal: null,
      opening_hours: "24/7",
    });
  });

  it("source は allowlist 外 → 拒否(throw)", () => {
    expect(() => validateEdit({ source: "user" })).toThrow(AdminEditValidationError);
    // name と source 混在でも source の存在で全体を拒否する。
    expect(() => validateEdit({ name: "ok", source: "user" })).toThrow(
      AdminEditValidationError
    );
  });

  it("dominant_access は allowlist 外(集計ビュー由来)→ 拒否", () => {
    expect(() => validateEdit({ dominant_access: "open" })).toThrow(
      AdminEditValidationError
    );
  });

  it("未知キーは拒否", () => {
    expect(() => validateEdit({ totally_unknown: 1 })).toThrow(AdminEditValidationError);
  });

  it("不正な inferred_access enum は拒否", () => {
    expect(() => validateEdit({ inferred_access: "maybe" })).toThrow(
      AdminEditValidationError
    );
    expect(() => validateEdit({ inferred_access: 123 })).toThrow(AdminEditValidationError);
    // null も不可(access を消す UX は別途)。
    expect(() => validateEdit({ inferred_access: null })).toThrow(AdminEditValidationError);
  });

  it("boolean 群の型違反は拒否", () => {
    expect(() => validateEdit({ has_washlet: "true" })).toThrow(AdminEditValidationError);
    expect(() => validateEdit({ is_universal: 1 })).toThrow(AdminEditValidationError);
  });

  it("boolean 群は null 許容(= 不明)", () => {
    expect(validateEdit({ has_diaper_table: null })).toEqual({ has_diaper_table: null });
  });

  it("name は null 可・長すぎは拒否", () => {
    expect(validateEdit({ name: null })).toEqual({ name: null });
    expect(() => validateEdit({ name: "あ".repeat(121) })).toThrow(AdminEditValidationError);
  });

  it("opening_hours は null 可・長すぎは拒否", () => {
    expect(validateEdit({ opening_hours: null })).toEqual({ opening_hours: null });
    expect(() => validateEdit({ opening_hours: "x".repeat(201) })).toThrow(
      AdminEditValidationError
    );
  });

  it("空 patch / オブジェクト以外は拒否", () => {
    expect(() => validateEdit({})).toThrow(AdminEditValidationError);
    expect(() => validateEdit(null)).toThrow(AdminEditValidationError);
    expect(() => validateEdit([])).toThrow(AdminEditValidationError);
    expect(() => validateEdit("name=x")).toThrow(AdminEditValidationError);
  });
});

describe("isSameOrigin", () => {
  function reqWith(headers: Record<string, string>): Request {
    return new Request("https://example.test/api/admin/x", { headers });
  }

  it("Origin の host が Host と一致 → true", () => {
    expect(
      isSameOrigin(reqWith({ host: "loomap.test", origin: "https://loomap.test" }))
    ).toBe(true);
  });

  it("Origin が別オリジン → false(CSRF 兆候)", () => {
    expect(
      isSameOrigin(reqWith({ host: "loomap.test", origin: "https://evil.test" }))
    ).toBe(false);
  });

  it("Origin 無しで Referer の origin が一致 → true", () => {
    expect(
      isSameOrigin(reqWith({ host: "loomap.test", referer: "https://loomap.test/admin" }))
    ).toBe(true);
  });

  it("Origin も Referer も無い → false(断定不能は deny)", () => {
    expect(isSameOrigin(reqWith({ host: "loomap.test" }))).toBe(false);
  });

  it("Host 無し → false", () => {
    expect(isSameOrigin(reqWith({ origin: "https://loomap.test" }))).toBe(false);
  });

  it("port を含む host も一致判定できる(ローカル開発)", () => {
    expect(
      isSameOrigin(reqWith({ host: "localhost:3000", origin: "http://localhost:3000" }))
    ).toBe(true);
  });
});
