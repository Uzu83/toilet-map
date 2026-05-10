import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // ja = デフォルト(プレフィックスなし)、en/ko/zh = /en /ko /zh
  locales: ["ja", "en", "ko", "zh"],
  defaultLocale: "ja",
  // デフォルトロケールはプレフィックスなし、それ以外は付く
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
