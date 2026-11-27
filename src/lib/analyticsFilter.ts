// Vercel Web Analytics の beforeSend 判定。
// 実ユーザーの /toilet/* と /area/*（ロケール付きを含む）は計測する。
// 無料枠をクローラ巡回で埋めないよう、ヘッドレスと既知クローラ UA だけ送らない。
// UA はここで照合するだけで、イベントには載せない。個人情報は足さない。

export type AnalyticsVisitorSignals = {
  /** navigator.webdriver === true のとき true。 */
  webdriver: boolean;
  /** navigator.userAgent。空文字ならクローラ扱いしない。 */
  userAgent: string;
};

/**
 * 公開サイトを巡回する既知クローラの UA 断片（小文字）。
 * 部分一致は製品名に限る。「bot」だけの判定は CUBOT などの実機を落とす。
 * アプリ内ブラウザ（LINE / Instagram / WhatsApp / Facebook アプリ / Google アプリ）は含めない。
 */
export const WELL_KNOWN_CRAWLER_UA_MARKERS = [
  "googlebot",
  "googleother",
  "google-inspectiontool",
  "google-extended",
  "adsbot-google",
  "mediapartners-google",
  "storebot-google",
  "apis-google",
  "bingbot",
  "bingpreview",
  "duckduckbot",
  "baiduspider",
  "yandexbot",
  "yandex.com/bots",
  "applebot",
  "petalbot",
  "ahrefsbot",
  "semrushbot",
  "mj12bot",
  "dotbot",
  "bytespider",
  "gptbot",
  "chatgpt-user",
  "oai-searchbot",
  "claudebot",
  "claude-user",
  "amazonbot",
  "facebookexternalhit",
  "facebot",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "discordbot",
  "telegrambot",
  "ia_archiver",
  "ccbot",
  "perplexitybot",
  "perplexity-user",
  "headlesschrome",
  "phantomjs",
] as const;

export function isWellKnownCrawlerUserAgent(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return WELL_KNOWN_CRAWLER_UA_MARKERS.some((marker) => ua.includes(marker));
}

/**
 * 送ってよいイベントはそのまま返し、捨てるときは null。
 * パスでは落とさない。オブジェクトはコピーも改変もしない。
 */
export function filterAnalyticsEvent<T extends { url: string }>(
  event: T,
  signals: AnalyticsVisitorSignals,
): T | null {
  if (signals.webdriver) return null;
  if (isWellKnownCrawlerUserAgent(signals.userAgent)) return null;
  return event;
}
