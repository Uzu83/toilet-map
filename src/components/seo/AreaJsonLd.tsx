type Crumb = { name: string; url: string };

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
  breadcrumb: Crumb[];
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
      {
        "@type": "BreadcrumbList",
        itemListElement: breadcrumb.map((c, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: c.name,
          item: c.url,
        })),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
