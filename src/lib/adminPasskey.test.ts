import { describe, expect, it } from "vitest";
import { makeFakeDb, makeFakeSupabase } from "@/app/api/admin/passkey/__tests__/fakeSupabase";
import {
  WEBAUTHN_CHALLENGE_TTL_SEC,
  consumeChallenge,
  isChallengeExpired,
  isOriginForRpId,
  saveChallenge,
} from "@/lib/adminPasskey";
import type { SupabaseClient } from "@supabase/supabase-js";

const NOW = Date.parse("2026-11-28T00:00:00Z");

describe("isOriginForRpId", () => {
  it("同じホストとサブドメインは OK", () => {
    expect(isOriginForRpId("https://loomap.test", "loomap.test")).toBe(true);
    expect(isOriginForRpId("https://www.loomap.test", "loomap.test")).toBe(true);
    expect(isOriginForRpId("http://localhost:3000", "localhost")).toBe(true);
  });
  it("別ドメイン・パス付き・末尾スラッシュは NG", () => {
    expect(isOriginForRpId("https://evil.test", "loomap.test")).toBe(false);
    expect(isOriginForRpId("https://evilloomap.test", "loomap.test")).toBe(false);
    expect(isOriginForRpId("https://loomap.test/", "loomap.test")).toBe(false);
    expect(isOriginForRpId("https://loomap.test/admin", "loomap.test")).toBe(false);
    expect(isOriginForRpId("not a url", "loomap.test")).toBe(false);
  });
});

describe("isChallengeExpired", () => {
  it("期限の前は有効、期限ちょうど以降は期限切れ、読めない値は期限切れ", () => {
    const exp = new Date(NOW + 1000).toISOString();
    expect(isChallengeExpired(exp, NOW)).toBe(false);
    expect(isChallengeExpired(exp, NOW + 1000)).toBe(true);
    expect(isChallengeExpired("garbage", NOW)).toBe(true);
  });
});

describe("saveChallenge / consumeChallenge", () => {
  it("1 回だけ取り出せる", async () => {
    const db = makeFakeDb();
    const sb = makeFakeSupabase(db) as unknown as SupabaseClient;
    const id = await saveChallenge(sb, "authentication", "challenge-abcdefghijkl", NOW);
    expect(id).toBeTruthy();
    expect(await consumeChallenge(sb, id!, "authentication", NOW)).toBe("challenge-abcdefghijkl");
    expect(await consumeChallenge(sb, id!, "authentication", NOW)).toBeNull();
  });

  it("期限は TTL 秒後。過ぎると null", async () => {
    const db = makeFakeDb();
    const sb = makeFakeSupabase(db) as unknown as SupabaseClient;
    const id = await saveChallenge(sb, "registration", "challenge-abcdefghijkl", NOW);
    expect(db.tables.admin_webauthn_challenges[0].expires_at).toBe(
      new Date(NOW + WEBAUTHN_CHALLENGE_TTL_SEC * 1000).toISOString(),
    );
    expect(await consumeChallenge(sb, id!, "registration", NOW + WEBAUTHN_CHALLENGE_TTL_SEC * 1000)).toBeNull();
  });

  it("用途が違う・uuid でない id は null", async () => {
    const db = makeFakeDb();
    const sb = makeFakeSupabase(db) as unknown as SupabaseClient;
    const id = await saveChallenge(sb, "registration", "challenge-abcdefghijkl", NOW);
    expect(await consumeChallenge(sb, id!, "authentication", NOW)).toBeNull();
    expect(await consumeChallenge(sb, "not-a-uuid", "registration", NOW)).toBeNull();
    expect(await consumeChallenge(sb, undefined, "registration", NOW)).toBeNull();
  });

  it("保存のついでに期限切れの行を消す", async () => {
    const db = makeFakeDb();
    const sb = makeFakeSupabase(db) as unknown as SupabaseClient;
    await saveChallenge(sb, "authentication", "challenge-old-abcdefgh", NOW);
    await saveChallenge(sb, "authentication", "challenge-new-abcdefgh", NOW + WEBAUTHN_CHALLENGE_TTL_SEC * 1000 + 1);
    expect(db.tables.admin_webauthn_challenges.map((r) => r.challenge)).toEqual(["challenge-new-abcdefgh"]);
  });

  it("期限切れの掃除が失敗しても challenge は保存する", async () => {
    const db = makeFakeDb();
    const sb = makeFakeSupabase(db) as unknown as SupabaseClient;
    // 次の 1 回(= 掃除の DELETE)だけ落とす
    db.failNext.admin_webauthn_challenges = { code: "XX000", message: "boom" };
    const id = await saveChallenge(sb, "authentication", "challenge-abcdefghijkl", NOW);
    expect(id).toBeTruthy();
    expect(await consumeChallenge(sb, id!, "authentication", NOW)).toBe("challenge-abcdefghijkl");
  });
});
