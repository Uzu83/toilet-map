import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initFeedbackFirestore = vi.fn();
const submitFeedbackDoc = vi.fn();

vi.mock("@tosagiken/feedback-web", () => ({
  initFeedbackFirestore: (...args: unknown[]) => initFeedbackFirestore(...args),
  submitFeedback: (...args: unknown[]) => submitFeedbackDoc(...args),
}));

describe("lib/feedback/client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    initFeedbackFirestore.mockReset();
    submitFeedbackDoc.mockReset();
    initFeedbackFirestore.mockReturnValue({ db: { __brand: "db" } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function load() {
    return import("./client");
  }

  function stubFirebaseEnv() {
    vi.stubEnv("NEXT_PUBLIC_FEEDBACK_FIREBASE_API_KEY", "key");
    vi.stubEnv(
      "NEXT_PUBLIC_FEEDBACK_FIREBASE_AUTH_DOMAIN",
      "feedback-adcd2.firebaseapp.com",
    );
    vi.stubEnv("NEXT_PUBLIC_FEEDBACK_FIREBASE_PROJECT_ID", "feedback-adcd2");
    vi.stubEnv("NEXT_PUBLIC_FEEDBACK_FIREBASE_APP_ID", "1:1:web:abc");
    vi.stubEnv("NEXT_PUBLIC_FEEDBACK_FIREBASE_MESSAGING_SENDER_ID", "1");
    vi.stubEnv(
      "NEXT_PUBLIC_FEEDBACK_FIREBASE_STORAGE_BUCKET",
      "feedback-adcd2.firebasestorage.app",
    );
  }

  it("resolveFeedbackTarget: prod のときだけ prod", async () => {
    const { resolveFeedbackTarget } = await load();
    expect(resolveFeedbackTarget()).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_FEEDBACK_TARGET", "prod");
    expect(resolveFeedbackTarget()).toBe("prod");
  });

  it("未設定なら Form フォールバック", async () => {
    const { submitFeedback, isFeedbackBackendConfigured, getFeedbackFormUrl } =
      await load();
    expect(isFeedbackBackendConfigured()).toBe(false);
    const r = await submitFeedback({ kind: "bug", message: "hello" });
    expect(r).toEqual({
      ok: false,
      error: "unavailable",
      fallbackUrl: getFeedbackFormUrl(),
    });
    expect(submitFeedbackDoc).not.toHaveBeenCalled();
  });

  it("空本文は empty", async () => {
    stubFirebaseEnv();
    const { submitFeedback, getFeedbackFormUrl } = await load();
    const r = await submitFeedback({ kind: "bug", message: "  " });
    expect(r).toEqual({
      ok: false,
      error: "empty",
      fallbackUrl: getFeedbackFormUrl(),
    });
  });

  it("設定あり・TARGET 無しなら target 省略で submit", async () => {
    stubFirebaseEnv();
    submitFeedbackDoc.mockResolvedValue({ ok: true, id: "abc" });
    const { submitFeedback, resetFeedbackDbCacheForTests } = await load();
    resetFeedbackDbCacheForTests();
    const r = await submitFeedback({ kind: "bug", message: "地図が固まる" });
    expect(r).toEqual({ ok: true, id: "abc" });
    expect(initFeedbackFirestore).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "feedback-adcd2" }),
    );
    expect(submitFeedbackDoc).toHaveBeenCalledTimes(1);
    const [, input, opts] = submitFeedbackDoc.mock.calls[0]!;
    expect(input).toMatchObject({
      product: "toilet-map",
      kind: "bug",
      screen: "contact",
      platform: "web",
      wantsReply: false,
    });
    expect(opts).toEqual({});
  });

  it("NEXT_PUBLIC_FEEDBACK_TARGET=prod なら target prod", async () => {
    stubFirebaseEnv();
    vi.stubEnv("NEXT_PUBLIC_FEEDBACK_TARGET", "prod");
    submitFeedbackDoc.mockResolvedValue({ ok: true, id: "prod1" });
    const { submitFeedback, resetFeedbackDbCacheForTests } = await load();
    resetFeedbackDbCacheForTests();
    await submitFeedback({ kind: "ux", message: "ボタンが遠い" });
    const opts = submitFeedbackDoc.mock.calls[0]![2];
    expect(opts).toEqual({ target: "prod" });
  });

  it("throw 時は network + Form", async () => {
    stubFirebaseEnv();
    submitFeedbackDoc.mockRejectedValue(new Error("boom"));
    const { submitFeedback, resetFeedbackDbCacheForTests, getFeedbackFormUrl } =
      await load();
    resetFeedbackDbCacheForTests();
    const r = await submitFeedback({ kind: "other", message: "hi" });
    expect(r).toEqual({
      ok: false,
      error: "network",
      fallbackUrl: getFeedbackFormUrl(),
    });
  });
});
