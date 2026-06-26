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

// og:locale の言語コード → OGP ロケール文字列マップ。
// WHY urls.ts に置くか: layout.tsx に定義していたが、child page が baseOpenGraph() で
// og:locale/type/siteName を spread するには共有が必要。layout から移動して単一ソース化。
const OG_LOCALE: Record<string, string> = {
  ja: "ja_JP",
  en: "en_US",
  ko: "ko_KR",
  zh: "zh_CN",
};

// #34 — 全ページの openGraph に共通フィールドを付与するヘルパ。
//
// WHY これが必要か:
//   Next.js の generateMetadata は親(layout)と子(page)の openGraph を「浅いマージ」で合成する。
//   子が `openGraph: { title, description, url }` だけを返すと
//   layout が設定した type/siteName/locale/alternateLocale が消える(浅いマージの仕様)。
//   各子ページでこの helper を spread することで og:locale / og:type / og:site_name を確実に維持する。
//
// alternateLocale を加える理由:
//   og:locale:alternate は Facebook/LINE プレビューで正しいロケールで表示するために有効。
//   全 4 ロケールのうち current locale を除く 3 つを列挙する。
export function baseOpenGraph(locale: string): {
  type: "website";
  siteName: string;
  locale: string;
  alternateLocale: string[];
} {
  const currentOg = OG_LOCALE[locale] ?? "ja_JP";
  const alternateLocale = Object.entries(OG_LOCALE)
    .filter(([k]) => k !== locale)
    .map(([, v]) => v);
  return {
    type: "website",
    siteName: "Loo map",
    locale: currentOg,
    alternateLocale,
  };
}
