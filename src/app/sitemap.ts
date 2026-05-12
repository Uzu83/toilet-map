import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { absUrl, languageAlternates } from "@/lib/urls";
import { areaSlugs } from "@/lib/areas";
import { getToiletIdsPage } from "@/lib/toilets";
import { SITEMAP_CHUNK_TOILETS, sitemapChunkCount } from "@/lib/sitemapChunks";

// コード版 sitemap は既定でキャッシュされる。Supabase のデータ変化を取り込むため日次で再生成。
export const revalidate = 86400;

const STATIC_PATHS = ["", "/about", "/contact", "/privacy", "/terms"] as const;

// id 0 = 静的ページ + 全エリアページ、id 1..N = トイレ個別ページのチャンク。
// NOTE: generateSitemaps はビルド時のみ実行され ISR 再検証では再呼び出しされない。
//       大規模シード(--all-japan)後にトイレ数が SITEMAP_CHUNK_TOILETS を超えて増えた場合は再デプロイが必要
//       (robots.ts も同じ sitemapChunkCount() を使うのでチャンク URL は常に sitemap 側と一致する)。
export async function generateSitemaps() {
  const n = await sitemapChunkCount();
  return Array.from({ length: n }, (_, i) => ({ id: i }));
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id);
  const now = new Date();

  // チャンク 0: 静的ページ + 全エリアページ(hreflang 付き)
  if (!Number.isFinite(id) || id === 0) {
    const entries: MetadataRoute.Sitemap = [];
    for (const path of STATIC_PATHS) {
      for (const locale of routing.locales) {
        entries.push({
          url: absUrl(locale, path),
          lastModified: now,
          changeFrequency: path === "" ? "daily" : "monthly",
          priority: path === "" ? 1 : 0.4,
          alternates: { languages: languageAlternates(path) },
        });
      }
    }
    for (const slug of areaSlugs()) {
      const path = `/area/${slug}`;
      for (const locale of routing.locales) {
        entries.push({
          url: absUrl(locale, path),
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.6,
          alternates: { languages: languageAlternates(path) },
        });
      }
    }
    return entries;
  }

  // チャンク N(>=1): トイレ個別ページ。ファイルサイズを抑えるため hreflang は省略
  //   (各ページの <link rel="alternate"> でロケール変種は発見できる)。
  const offset = (id - 1) * SITEMAP_CHUNK_TOILETS;
  const rows = await getToiletIdsPage(offset, SITEMAP_CHUNK_TOILETS).catch(() => []);
  return rows.flatMap((r) => {
    const path = `/toilet/${r.id}`;
    const lastModified = r.created_at ? new Date(r.created_at) : now;
    return routing.locales.map((locale) => ({
      url: absUrl(locale, path),
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    }));
  });
}
