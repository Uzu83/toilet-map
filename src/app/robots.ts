import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";
import { sitemapChunkCount } from "@/lib/sitemapChunks";

// #27 — robots.ts はビルド時に静的生成されるが、sitemap のチャンク数は日次で変わる(新トイレ追加
// によりチャンクが増減する)。revalidate = 86400 を付けて Next.js の ISR と同じ仕組みで日次再生成
// させる。これにより新チャンクが Google に見えるまでのラグを最大 1 日に抑える。
// sitemap.ts 自体もすでに revalidate = 86400 を持つので周期が揃う。
export const revalidate = 86400;

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
  const n = await sitemapChunkCount(); // 動的: 1(静的+area) + indexable トイレチャンク数(sitemapChunks.ts)
  return {
    rules: [
      { userAgent: BLOCKED_BOTS, disallow: "/" },
      { userAgent: "*", allow: "/" },
    ],
    sitemap: Array.from({ length: n }, (_, i) => `${base}/sitemap/${i}.xml`),
    // #28 — `host` は Yandex 独自拡張。RFC には存在せず Google/Bing は無視する。
    // さらにプレビューデプロイでは siteUrl() が Vercel プレビュー URL を返すため、
    // host に誤った preferred-host が残る(本番 URL を指定したい Yandex 向け意図と逆転)。
    // Yandex 対応が必要になった場合は NEXT_PUBLIC_SITE_URL で明示した URL を使うこと。
  };
}
