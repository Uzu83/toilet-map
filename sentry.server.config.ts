import * as Sentry from "@sentry/nextjs";

// #18 — tracesSampleRate を環境変数で上書き可能にする。
//   本番デフォルト 0.1(10%)は Sentry のトレース割り当てとパフォーマンスオーバーヘッドを抑えるため。
//   ローカル開発では SENTRY_TRACES_SAMPLE_RATE=1.0 を .env.local に設定してフルトレースを得る。
//   本番 Vercel では環境変数 SENTRY_TRACES_SAMPLE_RATE を設定して調整できる(デフォルト 0.1 のまま可)。
//   NOTE: 本番 Vercel env の設定はオーナーが行うこと(このコードは値を強制しない)。
Sentry.init({
  dsn: "https://c81f800022fafcc41c3d90f296402c0e@o4511570344280064.ingest.us.sentry.io/4511570392383488",
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
});
