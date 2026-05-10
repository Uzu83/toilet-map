import { getLocale, getTranslations } from "next-intl/server";
import { siteUrl } from "@/lib/siteUrl";
import { routing } from "@/i18n/routing";

const SCHEMA_LANG: Record<string, string> = { ja: "ja", en: "en", ko: "ko", zh: "zh" };

export async function StructuredData() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "metadata" });
  const base = siteUrl();
  const path = locale === routing.defaultLocale ? "" : `/${locale}`;
  const data = {
    "@context": "https://schema.org",
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
    author: { "@type": "Organization", name: "tosagiken", email: "tosagiken.info@gmail.com" },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
