// JSON-LD 生成の共通ヘルパ。ToiletJsonLd と AreaJsonLd で重複していたコードを単一ソースに統合する。
//
// WHY 分離するか:
//   両コンポーネントが同一の BreadcrumbList 構造を `breadcrumb.map((c, i) => ...)` で独自に組んでいた。
//   将来 schema.org の BreadcrumbList 仕様が変わった場合、両方を直さないと Google の検証が一方だけ落ちる。
//   共通化することで変更を 1 箇所に集め、JSON 出力の byte-identical 性を構造的に保証する。
//
// WHY "type" ではなく "interface" でもなく type alias か:
//   JsonLdCrumb は単純な 2 フィールドレコード。interface は extends/implements 需要がないため type alias で十分。

export type JsonLdCrumb = { name: string; url: string };

// BreadcrumbList ノードを組み立てる。
// 出力は schema.org BreadcrumbList の @type / itemListElement / ListItem の標準形式。
// WHY position が 1-indexed か: schema.org 仕様が「1 から始まる」と定義している。
export function buildBreadcrumbList(crumbs: JsonLdCrumb[]): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}
