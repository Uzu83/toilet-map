export type AccessLevel = "open" | "ask" | "permission";

// 色のみ。ラベル・説明は i18n メッセージ(messages/*.json の "access" 名前空間)から取得する。
export const ACCESS_COLORS: Record<AccessLevel, string> = {
  open: "#3B82F6",
  ask: "#F59E0B",
  permission: "#EF4444",
};

// バッジ/チップの「白文字 on 背景」専用の濃色版。WHY: 地図ピン用の ACCESS_COLORS は
// 鮮やかさ優先(#3B82F6 等)で、白文字を乗せると WCAG 4.5:1 を割る(open 3.68 / ask 2.15 /
// permission 3.76 と実測=全て不合格)。pin は「文字でない」ので ACCESS_COLORS のまま、
// 「文字を乗せるバッジ」だけ↓の濃色を使う。値は white 文字で実測 AA 合格を確認済み
// (open #2563EB=5.17:1 / ask #B45309=5.02:1 / permission #B91C1C=6.47:1)。
// ⚠️ 白文字バッジに ACCESS_COLORS を使うな(コントラスト不足が再発する)。
export const ACCESS_BADGE_COLORS: Record<AccessLevel, string> = {
  open: "#2563EB",
  ask: "#B45309",
  permission: "#B91C1C",
};

export const ACCESS_KEYS: AccessLevel[] = ["open", "ask", "permission"];

// 単一ソースの真実: 3 値 access_level の Set。
// WHY ReadonlySet: 下流で add/delete できないことを型で保証する。
// WHY ACCESS_KEYS から導出: enum 値を 2 箇所に書くと片方だけ伸びて齟齬が出るので派生させる。
// 置き換え対象: api/reviews, api/submissions, lib/adminAuth, lib/aiSuggestion の
// 局所的な `new Set(["open","ask","permission"])` を本定数に統一する。
export const ACCESS_SET: ReadonlySet<AccessLevel> = new Set(ACCESS_KEYS);

export type Toilet = {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  source: "osm" | "user" | "inferred";
  has_washlet: boolean | null;
  has_diaper_table: boolean | null;
  is_universal: boolean | null;
  review_count: number;
  avg_rating: number | null;
  dominant_access: AccessLevel | null;
  inferred_access: AccessLevel | null;
  opening_hours: string | null;
  not_a_toilet_count: number;
};

export type ReviewInput = {
  toiletId: string;
  rating: number;
  accessLevel: AccessLevel;
  hasWashlet: boolean | null;
  comment?: string;
  notAToilet?: boolean;
};

// pending 申請ピン。pending_submissions_in_bbox RPC(008)の戻り値に対応する表示用の最小形。
// ip_hash 等の個人データ・access_level/comment はピン表示に不要なため RPC で返さない(Codex #8)。
export type ToiletSubmission = {
  id: string;
  lat: number;
  lng: number;
  name: string | null;
  status: "pending" | "approved" | "rejected";
  confirm_count: number;
  created_at: string;
};

// 申請フォームの送信ペイロード(/api/submissions POST のボディ)。
export type SubmissionInput = {
  lat: number;
  lng: number;
  accessLevel: AccessLevel;
  name?: string;
  isOutdoor?: boolean;
  isUniversal?: boolean;
  comment?: string;
};

// ピンの最終表示色を決める(レビュー > 推定 > グレー)
export function effectiveAccess(t: Toilet): AccessLevel | null {
  if (t.dominant_access) return t.dominant_access;
  if (t.inferred_access) return t.inferred_access;
  return null;
}

// 「未確定」=レビュー10件未満(= 清潔度バッジを「参考値」と出す閾値)。
//
// [D6] WHY isUnconfirmed と isToiletUnconfirmed(lib/toiletSeo.ts)で predicate が異なるか:
//   isUnconfirmed は「UI ユーザー向けの信頼度警告」専用。source は関係なく、
//   OSM 由来でも reviews 件数が少なければ同じ警告バッジを表示する。
//   isToiletUnconfirmed は「SEO ページの title/description で『未確認』を表記するか」の判定で、
//   "review_count < 10 OR source === 'inferred'" という追加条件を持つ。
//   inferred ピンは group-confirmation が全くなくても source だけで「未確認」と断言する SEO 上の必要があるため。
//   この差異は意図的で、統合すると一方に不適切な判定が混入する(統合しない理由)。
export function isUnconfirmed(t: Toilet): boolean {
  return t.review_count < 10;
}

// 「推定ピン(群衆確認なし)」= source=inferred かつ review_count=0。
//
// WHY review_count === 0 の確認が必要か:
//   source=inferred でも 1 件以上のレビューが付けば「誰かが実際に使った」という群衆確認が生まれる。
//   このピンは「実態未確認の推定」から「確認済み拠点」に意味が変わるため、
//   推定専用の視覚区別(破線 + 半透明ピン / PinSheet の「未確認」バッジと警告文)を外す。
//   つまり review_count === 0 を外すと、確認済みの推定ピンに誤ってラベルが付き続ける。
//
// WHY isUnconfirmed/isToiletUnconfirmed と分けるか:
//   isUnconfirmed = review < 10 の信頼度バッジ(全 source に適用)。
//   isToiletUnconfirmed(lib/toiletSeo.ts) = review < 10 || source=inferred(SEO 用に source も混ぜた述語)。
//   isInferredPin = source=inferred && review=0 の「推定ピン視覚区別」だけに使う専用述語。
//   3 つが異なる条件を表すため、1 つに統合すると他の用途で誤った判定をするリスクが高い。
export function isInferredPin(t: Toilet): boolean {
  return t.source === "inferred" && t.review_count === 0;
}
