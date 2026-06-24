import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { absUrl, languageAlternates } from "@/lib/urls";
import { areaSlugs, findArea } from "@/lib/areas";
import { getIndexableToiletIdsPage, areaHasIndexableToilets } from "@/lib/toilets";
import { SITEMAP_CHUNK_TOILETS, sitemapChunkCount } from "@/lib/sitemapChunks";

// コード版 sitemap は既定でキャッシュされる。Supabase のデータ変化を取り込むため日次で再生成。
export const revalidate = 86400;

const STATIC_PATHS = ["", "/about", "/contact", "/privacy", "/terms"] as const;

// sitemap は id 0(静的ページ + 全エリアページ)+ id 1..(indexable トイレ個別ページ)で構成。
// indexable サブセット(canonical predicate, 設計書 §5.1)だけを掲載する(noindex のトイレは載せない)。
// チャンク数は indexable 件数から動的算出(sitemapChunks.ts)。generateSitemaps はビルド時に確定。
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
    // #30 — indexable トイレが 1 件もないエリアをサイトマップから除外する。
    //
    // WHY 並列 Promise.all か:
    //   57 エリア × getToiletsInRegion(bbox, 180) = 57 Supabase 呼び出しを直列にすると
    //   sitemap 生成が数十秒かかる。revalidate = 86400 で 24h に 1 回しか実行されないので
    //   並列化のコストは問題ない。失敗時は areaHasIndexableToilets が [] を返し false = 除外。
    //
    // WHY STATIC_PATHS は除外対象にしないか:
    //   静的ページ(/, /about, etc.)はエリア判定と無関係なので常にサイトマップに含める。
    //
    // KNOWN FALSE-NEGATIVE: #29 と同じ 180 件キャップの問題。index-reducing = ISR Write 安全。
    const slugs = areaSlugs();
    const hasIndexable = await Promise.all(
      slugs.map((slug) => {
        const area = findArea(slug);
        // findArea は areaSlugs() から作った slug なので undefined にならないが、型上は undefined あり。
        // undefined の場合は false として除外する(防御的フォールバック)。
        if (!area) return Promise.resolve(false);
        return areaHasIndexableToilets(area.bbox);
      })
    );
    for (let i = 0; i < slugs.length; i++) {
      if (!hasIndexable[i]) continue; // indexable トイレなし → サイトマップから除外
      const path = `/area/${slugs[i]}`;
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

  // チャンク N(>=1): indexable トイレ個別ページのみ。ファイルサイズを抑えるため hreflang は省略
  //   (各ページの <link rel="alternate"> でロケール変種は発見できる)。
  const offset = (id - 1) * SITEMAP_CHUNK_TOILETS;
  const rows = await getIndexableToiletIdsPage(offset, SITEMAP_CHUNK_TOILETS).catch(() => []);
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
