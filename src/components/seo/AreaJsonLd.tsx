import { buildBreadcrumbList, type JsonLdCrumb } from "./jsonLdHelpers";

// エリアランディングページの構造化データ。CollectionPage + BreadcrumbList。
export function AreaJsonLd({
  name,
  url,
  description,
  areaName,
  isPrefecture,
  inLanguage,
  breadcrumb,
}: {
  name: string;
  url: string;
  description: string;
  areaName: string;
  isPrefecture: boolean;
  inLanguage: string;
  breadcrumb: JsonLdCrumb[];
}) {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${url}#page`,
        name,
        url,
        description,
        inLanguage,
        about: {
          "@type": isPrefecture ? "AdministrativeArea" : "Place",
          name: areaName,
        },
      },
      buildBreadcrumbList(breadcrumb),
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
