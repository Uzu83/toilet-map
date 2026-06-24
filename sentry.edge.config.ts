import * as Sentry from "@sentry/nextjs";

// #18 — server config と同じ方針(コメント詳細は sentry.server.config.ts を参照)
Sentry.init({
  dsn: "https://c81f800022fafcc41c3d90f296402c0e@o4511570344280064.ingest.us.sentry.io/4511570392383488",
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
});
