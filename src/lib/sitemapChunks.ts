// sitemap の分割数を sitemap.ts と robots.ts で一致させるための共有ロジック。
// 両方ともビルド時に実行され、同じ getToiletCount() の結果で同数のチャンクを生成する。
import { getToiletCount } from "@/lib/toilets";

// 1 トイレチャンク = 4 ロケール × この件数 ≈ 4 倍の URL(Google 上限 50,000 未満になるよう 11,000)。
export const SITEMAP_CHUNK_TOILETS = 11_000;

// 返り値 = sitemap 総数。id 0 = 静的ページ + エリアページ、id 1..N = トイレ個別ページ。
export async function sitemapChunkCount(): Promise<number> {
  const total = await getToiletCount().catch(() => 0);
  const toiletChunks = Math.max(1, Math.ceil(total / SITEMAP_CHUNK_TOILETS));
  return toiletChunks + 1;
}
