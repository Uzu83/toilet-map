// Vercel Analytics カスタムイベント計装の薄いラッパ。
// Vercel Hobby は月 2,500 イベント無料、超過したら Pro。
// 失敗してもアプリの動作に影響させない(catch)。
// レビュー・投稿は送信成功(頂点)だけ計る。入力のキーストロークごとには飛ばさない。
// props にコメント本文・IP・名前・メールなどの個人情報は載せない。
// 場所を載せる場合は toiletId(UUID)までに留める。
//
// イベント一覧(名前 / いつ飛ぶか / props):
// - review_submit — ReviewForm のレビュー送信成功 — toiletId, rating, accessLevel
// - report_submit — ReviewForm の「トイレではない」報告の送信成功 — toiletId
// - add_toilet_submit — AddToiletFlow の新規申請成功。result は pending | promoted(outcome)
// - add_toilet_confirm — pending ピン追認(ConfirmPendingModal)の成功。result は pending | promoted
// - add_toilet_start — 追加フロー開始(FAB を 1 回)。成功頂点ではない — props なし
// - pin_share — ピン共有が完了したとき — toiletId, method
// - ko_fi_click — Ko-fi リンクのクリック — source

import { track } from "@vercel/analytics";

type EventProps = Record<string, string | number | boolean | null | undefined>;

export type SubmissionOutcome = "pending" | "promoted";

// 新規申請・追認とも、API が成功(pending / promoted)のときだけ props を返す。
// dup / throttled / 失敗では null。コメント・座標・名前は含めない。
export function submissionEventProps(
  result: string | null | undefined,
): { result: SubmissionOutcome } | null {
  if (result !== "pending" && result !== "promoted") return null;
  return { result };
}

export function trackEvent(name: string, props?: EventProps) {
  try {
    track(name, props);
  } catch {
    // ignore
  }
}
