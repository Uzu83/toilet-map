import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "./jsonLdHelpers";

describe("serializeJsonLd", () => {
  it("does not emit raw </script><script> and still parses to the original object", () => {
    const data = { name: "</script><script>alert(1)</script>" };
    const out = serializeJsonLd(data);
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual(data);
  });

  it("round-trips objects with >, &, U+2028 and U+2029", () => {
    const data = {
      title: "A & B > C",
      note: "line\u2028sep\u2029graph",
    };
    const out = serializeJsonLd(data);
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(JSON.parse(out)).toEqual(data);
  });

  it("leaves structured-data content unchanged for ordinary values", () => {
    const data = {
      "@context": "https://schema.org",
      "@type": "Place",
      name: "港区役所",
      url: "https://example.com/toilet/1",
    };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});
