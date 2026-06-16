import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://c81f800022fafcc41c3d90f296402c0e@o4511570344280064.ingest.us.sentry.io/4511570392383488",
  tracesSampleRate: 1.0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
