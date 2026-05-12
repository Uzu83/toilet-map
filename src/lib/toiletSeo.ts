// 個別トイレページの表示名・評価フォーマットの純粋ヘルパ(next-intl 非依存)。
// タイトル・説明文の組み立ては i18n 文言が要るのでページ側(getTranslations)で行う。

import type { AccessLevel, Toilet } from "@/types/toilet";
import { effectiveAccess } from "@/types/toilet";

export function toiletDisplayName(t: Toilet, fallback: string): string {
  const name = t.name?.trim();
  return name && name.length > 0 ? name : fallback;
}

export function formatRating(avg: number | null): string {
  return avg != null ? avg.toFixed(1) : "—";
}

export function toiletAccessKey(t: Toilet): AccessLevel | null {
  return effectiveAccess(t);
}

// レビュー10件未満 or 推定ピンは「未確認」扱い
export function isToiletUnconfirmed(t: Toilet): boolean {
  return t.review_count < 10 || t.source === "inferred";
}

export function toiletAmenityKeys(t: Toilet): ("washlet" | "diaperTable" | "universal")[] {
  const out: ("washlet" | "diaperTable" | "universal")[] = [];
  if (t.has_washlet) out.push("washlet");
  if (t.has_diaper_table) out.push("diaperTable");
  if (t.is_universal) out.push("universal");
  return out;
}
