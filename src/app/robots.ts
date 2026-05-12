import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";
import { sitemapChunkCount } from "@/lib/sitemapChunks";

// sitemap は generateSitemaps で /sitemap/[id].xml に分割されるため、全チャンクを列挙する
// (robots.txt は複数 Sitemap: 行を許可)。チャンク数は sitemap.ts と同じ sitemapChunkCount() で計算。
export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = siteUrl();
  const n = await sitemapChunkCount();
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: Array.from({ length: n }, (_, i) => `${base}/sitemap/${i}.xml`),
    host: base,
  };
}
