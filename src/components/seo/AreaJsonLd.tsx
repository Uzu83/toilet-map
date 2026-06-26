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
  count,
}: {
  name: string;
  url: string;
  description: string;
  areaName: string;
  isPrefecture: boolean;
  inLanguage: string;
  breadcrumb: JsonLdCrumb[];
  // #33 — count を渡すと CollectionPage に numberOfItems を付与する。
  // schema.org CollectionPage / ItemList に数を明示すると Google がリッチスニペット候補に。
  // 省略時は undefined = 出力しない(後方互換)。
  count?: number;
}) {
  const collectionPage: Record<string, unknown> = {
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
  };
  if (count !== undefined) collectionPage.numberOfItems = count;

  const data = {
    "@context": "https://schema.org",
    "@graph": [
      collectionPage,
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
