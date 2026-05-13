import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";
import { sitemapChunkCount } from "@/lib/sitemapChunks";

// 検索エンジン(Googlebot / Bingbot 等)は全面許可。
// 一方、SEO ツール系・スクレイパ系の高負荷クローラ(検索流入には繋がらず帯域・関数実行だけ食う)は Disallow。
// ※ robots.txt を守らないクローラには効かない。それは別途 Vercel Firewall 等で。
const BLOCKED_BOTS = [
  "AhrefsBot",
  "SemrushBot",
  "MJ12bot",
  "DotBot",
  "BLEXBot",
  "DataForSeoBot",
  "PetalBot",
  "Bytespider",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = siteUrl();
  const n = await sitemapChunkCount(); // 現状は 1(個別トイレページは sitemap 非掲載)
  return {
    rules: [
      { userAgent: BLOCKED_BOTS, disallow: "/" },
      { userAgent: "*", allow: "/" },
    ],
    sitemap: Array.from({ length: n }, (_, i) => `${base}/sitemap/${i}.xml`),
    host: base,
  };
}
