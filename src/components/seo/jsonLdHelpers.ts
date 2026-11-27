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

// JSON-LD を <script type="application/ld+json"> に埋め込むための直列化。
//
// WHY JSON.stringify のままでは足りないか:
//   トイレ名などユーザー由来の文字列が `</script>` を含むと、HTML パーサが
//   script 要素をそこで閉じてしまい、後続がページに挿入される。
//   JSON.stringify は `<` `>` `&` をエスケープしない。
//
// WHY \u003c 等の JSON エスケープか:
//   出力は JSON として同じ値にパースされる必要がある。HTML 実体参照にすると
//   JSON.parse の結果が変わってしまう。
//   `<` に加え `>` `&`、U+2028 / U+2029 も同様にエスケープする
//   (`>` は対称性、`&` は実体参照の誤解釈防止、U+2028/U+2029 は JS 行区切り)。
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
