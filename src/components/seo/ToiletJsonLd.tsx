import type { Toilet } from "@/types/toilet";
import { buildBreadcrumbList, type JsonLdCrumb } from "./jsonLdHelpers";

// 個別トイレページの構造化データ。Place/PublicToilet + BreadcrumbList を @graph で注入。
export function ToiletJsonLd({
  toilet,
  name,
  url,
  inLanguage,
  amenityLabels,
  breadcrumb,
}: {
  toilet: Toilet;
  name: string;
  url: string;
  inLanguage: string;
  // {washlet,diaperTable,universal} のうち true のものだけ呼び出し側で渡す
  amenityLabels: string[];
  breadcrumb: JsonLdCrumb[];
}) {
  const place: Record<string, unknown> = {
    "@type": ["Place", "PublicToilet"],
    "@id": `${url}#place`,
    name,
    url,
    geo: {
      "@type": "GeoCoordinates",
      latitude: toilet.lat,
      longitude: toilet.lng,
    },
    publicAccess: true,
  };
  if (toilet.opening_hours) place.openingHours = toilet.opening_hours;
  if (amenityLabels.length) {
    place.amenityFeature = amenityLabels.map((value) => ({
      "@type": "LocationFeatureSpecification",
      name: value,
      value: true,
    }));
  }
  if (toilet.review_count >= 1 && toilet.avg_rating != null) {
    place.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: toilet.avg_rating,
      reviewCount: toilet.review_count,
      bestRating: 5,
      worstRating: 1,
    };
  }

  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { ...place, inLanguage },
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
