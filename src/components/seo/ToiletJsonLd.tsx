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
  // aggregateRating は JSON-LD に出力しない(⚠️ 再追加するな)。
  //
  // [GSC fix / 2026-06-25] WHY aggregateRating を出さないか(背景 → 根拠 → 決定 → 帰結):
  //   背景: 以前は Place ノードに aggregateRating を付けていた(review_count>=1、後に PR3 #31 で >=10 に
  //     引き上げ)。しかし Search Console が「レビュー スニペットの構造化データ: 項目<parent_node>の
  //     オブジェクト タイプが無効です」(重大・リッチリザルト対象外)を検出した。
  //   根拠: Google のレビュースニペット対応型は Book/Course/Event/LocalBusiness/Movie/Product/Recipe/
  //     SoftwareApp/Organization 等のみで、Place/PublicToilet/CivicStructure は非対応
  //     (https://developers.google.com/search/docs/appearance/structured-data/review-snippet で確認)。
  //     非対応型に aggregateRating を付けても SERP に星は出ず、「無効アイテム」としてエラーになるだけ
  //     = 得るものゼロ・エラーだけ出す状態だった。
  //   決定: aggregateRating を JSON-LD から除去(Codex 異モデル合意)。公衆トイレを LocalBusiness 等の
  //     対応型に @type 変更して星を狙うのは「型の誤表示」= Google 構造化データ ガイドライン違反(手動対策
  //     リスク)なので採らない。トイレは元々レビュースニペット非対象 = 星は出せない、が正しい理解。
  //   帰結: ページ上の可視「星(清潔度)」表示は JSON-LD と独立(toilet.avg_rating から描画)なので不変。
  //     Place/PublicToilet としての構造化データ(geo/amenityFeature/openingHours 等)は引き続き valid。
  //   ⚠️ もし将来レビュー星を SERP に出したくなっても、Place に aggregateRating を戻すと同じ GSC エラーが
  //     再発する。supported type の正当な適用が無い限り出力しないこと。

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
