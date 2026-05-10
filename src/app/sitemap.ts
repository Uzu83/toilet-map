import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";
import { routing } from "@/i18n/routing";

const PATHS = ["", "/contact", "/privacy", "/terms"] as const;
const PRIORITY: Record<(typeof PATHS)[number], number> = {
  "": 1.0,
  "/contact": 0.5,
  "/privacy": 0.3,
  "/terms": 0.3,
};
const FREQ: Record<(typeof PATHS)[number], "daily" | "monthly" | "yearly"> = {
  "": "daily",
  "/contact": "monthly",
  "/privacy": "yearly",
  "/terms": "yearly",
};

function localizedUrl(base: string, locale: string, path: string): string {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return `${base}${prefix}${path}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];
  for (const path of PATHS) {
    for (const locale of routing.locales) {
      entries.push({
        url: localizedUrl(base, locale, path),
        lastModified: now,
        changeFrequency: FREQ[path],
        priority: PRIORITY[path],
        alternates: {
          languages: Object.fromEntries(
            routing.locales.map((l) => [l, localizedUrl(base, l, path)])
          ),
        },
      });
    }
  }
  return entries;
}
