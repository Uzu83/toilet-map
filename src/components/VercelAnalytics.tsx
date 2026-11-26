"use client";

import { Analytics } from "@vercel/analytics/next";
import { filterAnalyticsEvent } from "@/lib/analyticsFilter";

// 実ユーザーの /toilet/* と /area/*（/en/toilet/... などロケール付きを含む）は計測する。
// ヘッドレス（navigator.webdriver）と既知クローラ UA だけ送らない。
// UA は判定にだけ使い、イベントには載せない。
// beforeSend は関数なので Client Component から渡す（layout は Server Component）。
export function VercelAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        try {
          return filterAnalyticsEvent(event, {
            webdriver: typeof navigator !== "undefined" && navigator.webdriver === true,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          });
        } catch {
          // 判定できないときは実ユーザーを落とさない
          return event;
        }
      }}
    />
  );
}
