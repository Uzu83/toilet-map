import { siteUrl } from "@/lib/siteUrl";

export function StructuredData() {
  const url = siteUrl();
  const data = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Loo map",
    alternateName: ["Loo Map", "ルーマップ", "toilet-map"],
    description:
      "近くの公衆トイレを「許可不要(青)・声かけ要(黄)・許可要(赤)」のピンと星1-5の清潔度で3タップ以内に探せる地図。福岡市から順次全国へ展開予定。",
    url,
    applicationCategory: "TravelApplication",
    operatingSystem: "Any (Web)",
    browserRequirements: "Requires JavaScript and Geolocation API",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "JPY",
    },
    inLanguage: "ja",
    author: {
      "@type": "Organization",
      name: "tosagiken",
      email: "tosagiken.info@gmail.com",
    },
  };
  return (
    <script
      type="application/ld+json"
      // JSON.stringify はエスケープ不要、`<` 等は出ない
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
