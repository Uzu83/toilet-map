import * as Sentry from "@sentry/nextjs";

// #18 — server config と同じ方針(コメント詳細は sentry.server.config.ts を参照)。
//   クライアントサイドでは process.env.SENTRY_TRACES_SAMPLE_RATE は Next が NEXT_PUBLIC_
//   でない env をバンドルに含めないため、ここでは undefined になる → デフォルト 0.1 が適用される。
//   クライアントトレースを本番でフルにしたい場合は NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE を追加し、
//   ここで参照するか、サーバ設定のみで計装する(本番クライアントは 0.1 のままで通常は十分)。
Sentry.init({
  dsn: "https://c81f800022fafcc41c3d90f296402c0e@o4511570344280064.ingest.us.sentry.io/4511570392383488",
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
