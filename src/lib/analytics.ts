// Vercel Analytics カスタムイベント計装の薄いラッパ
// Vercel Hobby は月 2,500 イベント無料、超過したら Pro。
// 失敗してもアプリの動作に影響させない(catch)。

import { track } from "@vercel/analytics";

type EventProps = Record<string, string | number | boolean | null | undefined>;

export function trackEvent(name: string, props?: EventProps) {
  try {
    track(name, props);
  } catch {
    // ignore
  }
}
