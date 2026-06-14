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

// 個別トイレページを検索エンジンに index させるか(canonical predicate, 設計書 §5.1)。
//
//   INDEXABLE(t) := not_a_toilet_count < 5
//                AND ( review_count > 0
//                      OR ( source = 'osm' AND NAMED(t) ) )
//   NAMED(t) := name に空白以外の文字が 1 つ以上ある((name?.trim().length ?? 0) > 0)
//
// 「ない」報告が 5 件以上のトイレ(=ページが notFound 扱い)は除外。
// review が 1 件でも付けば従来通り indexable に昇格(AC4 退行防止)。加えて source='osm' で
// 名称ありのトイレを新シグナルとして index 化する(名前 + amenity + 地図リンクより情報量が多く
// thin-content リスクが低い)。inferred(駅/モール等)は実物トイレ非特定の UX 問題があるため除外。
// この述語は sitemap 用 RPC(migration 007)の WHERE と同一の真理値表を満たす(§5.2)。
export function isToiletIndexable(t: Toilet): boolean {
  if (t.not_a_toilet_count >= 5) return false;
  if (t.review_count > 0) return true;
  const named = (t.name?.trim().length ?? 0) > 0;
  return t.source === "osm" && named;
}

export function toiletAmenityKeys(t: Toilet): ("washlet" | "diaperTable" | "universal")[] {
  const out: ("washlet" | "diaperTable" | "universal")[] = [];
  if (t.has_washlet) out.push("washlet");
  if (t.has_diaper_table) out.push("diaperTable");
  if (t.is_universal) out.push("universal");
  return out;
}
