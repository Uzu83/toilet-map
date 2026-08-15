/*
 * feedback/client.ts — feedback-adcd2（Firestore）への送信
 *
 * 手順の正: ~/development/projects/feedback-platform/docs/CONNECT.md
 *
 * WHY vendor 経由か:
 *   file:../feedback-platform は Vercel CI で親ディレクトリが無く壊れる。
 * WHY wantsReply 固定 false:
 *   Spark では contacts TTL が走らず同意文を破る（CONTACT_PERSISTENCE_ENABLED=false）。
 */
import {
  initFeedbackFirestore,
  submitFeedback as submitFeedbackDoc,
  type FeedbackTarget,
} from "@tosagiken/feedback-web";
import type { FeedbackKind } from "@tosagiken/feedback-core";
import type { Firestore } from "firebase/firestore";
import { CONTACT_FORM_URL } from "@/lib/contact";

export const FEEDBACK_KINDS = ["bug", "feature", "ux", "other"] as const;
export type ToiletFeedbackKind = (typeof FEEDBACK_KINDS)[number];

const PRODUCT = "toilet-map";
const SCREEN = "contact";
/** package.json version と揃える（JSON import を避ける）。 */
const APP_VERSION = "0.1.0";

/**
 * WHY 静的 process.env.NEXT_PUBLIC_* 参照か:
 *   Next のクライアントバンドルは動的 process.env[name] をインラインしない。
 *   動的 lookup だと本番でも常に undefined → Form フォールバック固定になる。
 */
function nonEmpty(v: string | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function feedbackFirebaseConfig() {
  return {
    apiKey: nonEmpty(process.env.NEXT_PUBLIC_FEEDBACK_FIREBASE_API_KEY),
    authDomain: nonEmpty(process.env.NEXT_PUBLIC_FEEDBACK_FIREBASE_AUTH_DOMAIN),
    projectId: nonEmpty(process.env.NEXT_PUBLIC_FEEDBACK_FIREBASE_PROJECT_ID),
    appId: nonEmpty(process.env.NEXT_PUBLIC_FEEDBACK_FIREBASE_APP_ID),
    messagingSenderId: nonEmpty(
      process.env.NEXT_PUBLIC_FEEDBACK_FIREBASE_MESSAGING_SENDER_ID,
    ),
    storageBucket: nonEmpty(
      process.env.NEXT_PUBLIC_FEEDBACK_FIREBASE_STORAGE_BUCKET,
    ),
  };
}

/** Google Form フォールバック（障害・未設定時）。 */
export function getFeedbackFormUrl(): string {
  return CONTACT_FORM_URL;
}

/** Firebase Web config が揃っているか。 */
export function isFeedbackBackendConfigured(): boolean {
  const c = feedbackFirebaseConfig();
  return Boolean(
    c.apiKey &&
      c.authDomain &&
      c.projectId &&
      c.appId &&
      c.messagingSenderId &&
      c.storageBucket,
  );
}

/** Production だけ NEXT_PUBLIC_FEEDBACK_TARGET=prod。それ以外は省略 → feedback_dev。 */
export function resolveFeedbackTarget(): FeedbackTarget | undefined {
  return process.env.NEXT_PUBLIC_FEEDBACK_TARGET === "prod" ? "prod" : undefined;
}

export type FeedbackSubmitInput = {
  kind: ToiletFeedbackKind;
  message: string;
};

export type FeedbackSubmitResult =
  | { ok: true; id: string }
  | { ok: false; error: string; fallbackUrl?: string };

let dbCache: Firestore | null = null;

function getDb(): Firestore {
  if (dbCache) return dbCache;
  const c = feedbackFirebaseConfig();
  const { db } = initFeedbackFirestore({
    apiKey: c.apiKey!,
    authDomain: c.authDomain!,
    projectId: c.projectId!,
    appId: c.appId!,
    messagingSenderId: c.messagingSenderId!,
    storageBucket: c.storageBucket!,
  });
  dbCache = db;
  return db;
}

/** テスト用に DB キャッシュを捨てる。 */
export function resetFeedbackDbCacheForTests(): void {
  dbCache = null;
}

/**
 * フィードバック送信。
 * Firestore 未設定時は Form URL を fallback として返す。
 * error は UI 側で i18n キーにマップする短いコード、または SDK の日本語文。
 */
export async function submitFeedback(
  input: FeedbackSubmitInput,
): Promise<FeedbackSubmitResult> {
  const fallbackUrl = getFeedbackFormUrl();
  const message = input.message.trim();
  if (!message) {
    return { ok: false, error: "empty", fallbackUrl };
  }

  if (!isFeedbackBackendConfigured()) {
    return {
      ok: false,
      error: "unavailable",
      fallbackUrl,
    };
  }

  try {
    const db = getDb();
    const target = resolveFeedbackTarget();
    const result = await submitFeedbackDoc(
      db,
      {
        product: PRODUCT,
        kind: input.kind as FeedbackKind,
        message: message.length <= 2000 ? message : message.slice(0, 2000),
        screen: SCREEN,
        platform: "web",
        appVersion: APP_VERSION,
        wantsReply: false,
      },
      target ? { target } : {},
    );
    if (!result.ok) {
      return { ok: false, error: result.error, fallbackUrl };
    }
    return { ok: true, id: result.id };
  } catch {
    return {
      ok: false,
      error: "network",
      fallbackUrl,
    };
  }
}
