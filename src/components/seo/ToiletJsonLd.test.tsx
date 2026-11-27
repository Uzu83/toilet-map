import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Toilet } from "@/types/toilet";
import { ToiletJsonLd } from "./ToiletJsonLd";

function makeToilet(overrides: Partial<Toilet> = {}): Toilet {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    name: "テストトイレ",
    lat: 35.6580389,
    lng: 139.7515632,
    source: "osm",
    has_washlet: null,
    has_diaper_table: null,
    is_universal: null,
    review_count: 0,
    avg_rating: null,
    dominant_access: null,
    inferred_access: null,
    opening_hours: null,
    not_a_toilet_count: 0,
    ...overrides,
  };
}

function jsonLdPayload(html: string): string {
  const open = '<script type="application/ld+json">';
  const start = html.indexOf(open);
  expect(start).toBeGreaterThanOrEqual(0);
  const from = start + open.length;
  const end = html.indexOf("</script>", from);
  expect(end).toBeGreaterThan(from);
  // ペイロード内に生の </script> が残っていると、最初の閉じタグで切れてしまう。
  expect(html.indexOf("</script>", end + 1)).toBe(-1);
  return html.slice(from, end);
}

describe("ToiletJsonLd", () => {
  it("escapes </script><script> in the toilet name and still parses to the same data", () => {
    const name = "</script><script>alert(1)</script>";
    const html = renderToStaticMarkup(
      <ToiletJsonLd
        toilet={makeToilet({ name })}
        name={name}
        url="https://example.com/toilet/1"
        inLanguage="ja"
        amenityLabels={[]}
        breadcrumb={[{ name: "Home", url: "https://example.com/" }, { name, url: "https://example.com/toilet/1" }]}
      />,
    );

    expect(html).not.toContain("</script><script>");
    const payload = jsonLdPayload(html);
    expect(payload).not.toContain("<");
    const parsed = JSON.parse(payload) as {
      "@graph": Array<{ name?: string; itemListElement?: Array<{ name: string }> }>;
    };
    expect(parsed["@graph"][0]?.name).toBe(name);
    expect(parsed["@graph"][1]?.itemListElement?.at(-1)?.name).toBe(name);
  });
});
