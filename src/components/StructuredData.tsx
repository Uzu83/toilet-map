import { getLocale, getTranslations } from "next-intl/server";
import { siteUrl } from "@/lib/siteUrl";
import { routing } from "@/i18n/routing";

const SCHEMA_LANG: Record<string, string> = { ja: "ja", en: "en", ko: "ko", zh: "zh" };

export async function StructuredData() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "metadata" });
  const base = siteUrl();
  const path = locale === routing.defaultLocale ? "" : `/${locale}`;

  // #32 — @graph に WebSite と拡張 Organization を追加する。
  //
  // WHY WebSite ノードが必要か:
  //   Google のサイトリンクスコアボックスや SiteSearch はトップページに WebSite ノードがあると
  //   認識しやすい。@id を "/#website" で固定することで他ページが sameAs で参照できる。
  //
  // WHY Organization を @graph 内に分離するか:
  //   WebApplication の author として埋め込むより @id 付き独立ノードにする方が
  //   Knowledge Panel や他ページの publisher 参照が繋がりやすい。
  //
  // WHY logo に icon-512.svg か:
  //   Google は 112×112 以上の正方形 PNG/SVG を推奨。public/icons/icon-512.svg は
  //   512×512 相当で要件を満たす(PWA manifest の icons と同じファイル)。
  //   ロゴに実名・メアドを含まない(public-info policy)。
  const publisher = {
    "@type": "Organization",
    "@id": `${base}/#publisher`,
    name: "TosaGiken",
    url: base,
    logo: {
      "@type": "ImageObject",
      url: `${base}/icons/icon-512.svg`,
    },
  };

  const webSite = {
    "@type": "WebSite",
    "@id": `${base}/#website`,
    name: "Loo map",
    url: `${base}${path}`,
    inLanguage: SCHEMA_LANG[locale] ?? "ja",
    publisher: { "@id": `${base}/#publisher` },
  };

  const webApp = {
    "@type": "WebApplication",
    name: "Loo map",
    alternateName: ["Loo Map", "ルーマップ", "toilet-map"],
    description: t("description"),
    url: `${base}${path}`,
    applicationCategory: "TravelApplication",
    operatingSystem: "Any (Web)",
    browserRequirements: "Requires JavaScript and Geolocation API",
    offers: { "@type": "Offer", price: "0", priceCurrency: "JPY" },
    inLanguage: SCHEMA_LANG[locale] ?? "ja",
    author: { "@id": `${base}/#publisher` },
  };

  const data = {
    "@context": "https://schema.org",
    "@graph": [publisher, webSite, webApp],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
