"use client";

import { Analytics } from "@vercel/analytics/next";

// プログラマティック SEO ページ(/toilet/*, /area/*)はクローラ巡回が大半で
// 実ユーザはほぼ来ないため、これらの pageview を計測から除外して
// Web Analytics を「実ユーザの動線」に絞る(無料枠の節約も兼ねる)。
// ヘッドレスブラウザ(navigator.webdriver)も除外。
// beforeSend は関数なので Client Component から渡す必要がある(layout は Server Component)。
const EXCLUDED_SEGMENTS = ["toilet", "area"];

function isExcludedPath(pathname: string): boolean {
  // "/toilet/xxx" "/en/toilet/xxx" "/area/jp-40" "/zh/area/..." をまとめて判定
  const segments = pathname.split("/").filter(Boolean);
  return segments.some((s) => EXCLUDED_SEGMENTS.includes(s));
}

export function VercelAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        try {
          if (typeof navigator !== "undefined" && navigator.webdriver) return null;
          const { pathname } = new URL(event.url);
          if (isExcludedPath(pathname)) return null;
        } catch {
          // URL パース失敗時はそのまま送る
        }
        return event;
      }}
    />
  );
}
