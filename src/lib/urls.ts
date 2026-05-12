// ロケール付き URL ヘルパ(metadata の canonical / hreflang / sitemap で共用)。
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/siteUrl";

export function localePrefix(locale: string): string {
  return locale === routing.defaultLocale ? "" : `/${locale}`;
}

// 絶対 URL。path は "/about" のように先頭スラッシュ込み(トップは "")。
export function absUrl(locale: string, path: string): string {
  return `${siteUrl()}${localePrefix(locale)}${path}`;
}

// metadata.alternates.languages 用(全ロケール + x-default)。
export function languageAlternates(path: string): Record<string, string> {
  const langs: Record<string, string> = {};
  for (const l of routing.locales) langs[l] = absUrl(l, path);
  langs["x-default"] = absUrl(routing.defaultLocale, path);
  return langs;
}

// JSON-LD の inLanguage 用(ロケールコードそのまま)。
export function inLanguageOf(locale: string): string {
  return routing.locales.includes(locale as (typeof routing.locales)[number]) ? locale : routing.defaultLocale;
}
