import { describe, expect, it } from "vitest";
import {
  WELL_KNOWN_CRAWLER_UA_MARKERS,
  filterAnalyticsEvent,
  isWellKnownCrawlerUserAgent,
} from "@/lib/analyticsFilter";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const REAL_USER = { webdriver: false, userAgent: CHROME_UA };

const TOILET_ID = "11111111-1111-1111-1111-111111111111";

function pageview(url: string) {
  return { type: "pageview" as const, url };
}

describe("filterAnalyticsEvent — 実ユーザーの /toilet と /area", () => {
  const urls = [
    `https://example.com/toilet/${TOILET_ID}`,
    "https://example.com/area/jp-40",
    "https://example.com/area/fukuoka-city",
    `https://example.com/en/toilet/${TOILET_ID}`,
    "https://example.com/ko/toilet/abc",
    "https://example.com/zh/area/jp-13",
    "https://example.com/ja/toilet/abc",
    "https://example.com/en/area/tokyo-23",
    `https://example.com/toilet/${TOILET_ID}?utm_source=google`,
    "https://example.com/ko/area/fukuoka-city/",
  ];

  it.each(urls)("%s をそのまま送る", (url) => {
    const event = pageview(url);
    expect(filterAnalyticsEvent(event, REAL_USER)).toBe(event);
  });

  it("カスタムイベントもパスでは落とさず、中身を変えない", () => {
    const event = {
      type: "event" as const,
      url: `https://example.com/en/toilet/${TOILET_ID}`,
    };
    expect(filterAnalyticsEvent(event, REAL_USER)).toBe(event);
    expect(event).toEqual({
      type: "event",
      url: `https://example.com/en/toilet/${TOILET_ID}`,
    });
  });
});

describe("filterAnalyticsEvent — 従来から送っていたパス", () => {
  it.each([
    "https://example.com/",
    "https://example.com/en",
    "https://example.com/ko",
    "https://example.com/zh",
    "https://example.com/about",
    "https://example.com/privacy",
    "https://example.com/terms",
    "https://example.com/contact",
    "https://example.com/?id=11111111-1111-1111-1111-111111111111",
  ])("%s は実ユーザーなら送る", (url) => {
    const event = pageview(url);
    expect(filterAnalyticsEvent(event, REAL_USER)).toBe(event);
  });

  it("URL が壊れていても実ユーザーは送る", () => {
    const event = pageview("not a url");
    expect(filterAnalyticsEvent(event, REAL_USER)).toBe(event);
  });
});

describe("filterAnalyticsEvent — navigator.webdriver", () => {
  it.each([
    `https://example.com/toilet/${TOILET_ID}`,
    "https://example.com/area/jp-40",
    `https://example.com/en/toilet/${TOILET_ID}`,
    "https://example.com/zh/area/jp-13",
    "https://example.com/",
    "https://example.com/about",
    "not a url",
  ])("webdriver なら %s を送らない", (url) => {
    const event = pageview(url);
    expect(
      filterAnalyticsEvent(event, { webdriver: true, userAgent: CHROME_UA }),
    ).toBeNull();
  });

  it("webdriver のカスタムイベントも送らない", () => {
    const event = { type: "event" as const, url: "https://example.com/" };
    expect(
      filterAnalyticsEvent(event, { webdriver: true, userAgent: CHROME_UA }),
    ).toBeNull();
  });

  it("webdriver が false なら通常ブラウザは送る", () => {
    const event = pageview(`https://example.com/toilet/${TOILET_ID}`);
    expect(filterAnalyticsEvent(event, { webdriver: false, userAgent: CHROME_UA })).toBe(event);
  });
});

describe("filterAnalyticsEvent — 既知クローラ UA", () => {
  it.each(WELL_KNOWN_CRAWLER_UA_MARKERS)("UA に %s を含むと送らない", (marker) => {
    const event = pageview(`https://example.com/en/area/jp-40`);
    expect(
      filterAnalyticsEvent(event, {
        webdriver: false,
        userAgent: `Mozilla/5.0 (compatible; ${marker}/1.0)`,
      }),
    ).toBeNull();
  });

  it("Chrome に見せかけた Googlebot も送らない", () => {
    const event = pageview(`https://example.com/toilet/${TOILET_ID}`);
    const ua =
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    expect(filterAnalyticsEvent(event, { webdriver: false, userAgent: ua })).toBeNull();
    expect(isWellKnownCrawlerUserAgent(ua)).toBe(true);
  });

  it("大文字の Bingbot も送らない", () => {
    const event = pageview("https://example.com/");
    expect(
      filterAnalyticsEvent(event, {
        webdriver: false,
        userAgent: "Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      }),
    ).toBeNull();
  });
});

describe("filterAnalyticsEvent — 実ユーザーの UA は落とさない", () => {
  const userAgents: Array<[string, string]> = [
    ["Chrome", CHROME_UA],
    [
      "Safari iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    ],
    [
      "Firefox",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
    ],
    [
      "Edge",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    ],
    [
      "Samsung Internet",
      "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
    ],
    [
      "LINE",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.0.0",
    ],
    [
      "Instagram",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0",
    ],
    [
      "Facebook app",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0.0;]",
    ],
    [
      "WhatsApp",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.10.0",
    ],
    [
      "Google app",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/340.0.0 Mobile/15E148 Safari/604.1",
    ],
    [
      "DuckDuckGo browser",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15",
    ],
    [
      "CUBOT",
      "Mozilla/5.0 (Linux; Android 11; CUBOT NOTE 20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Mobile Safari/537.36",
    ],
    ["empty", ""],
  ];

  it.each(userAgents)("%s の /toilet は送る", (_label, userAgent) => {
    const event = pageview(`https://example.com/zh/toilet/${TOILET_ID}`);
    expect(filterAnalyticsEvent(event, { webdriver: false, userAgent })).toBe(event);
    expect(isWellKnownCrawlerUserAgent(userAgent)).toBe(false);
  });
});
