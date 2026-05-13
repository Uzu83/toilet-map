// sitemap の分割数を sitemap.ts と robots.ts で一致させるための共有ロジック。
//
// 現状: 個別トイレページ(/toilet/[id])はレビュー 0 件のものが大半で thin content + クローラ巡回コスト過大なため
// noindex,follow にしており、sitemap には載せない。よって sitemap は 1 個(id 0 = 静的ページ + 全エリアページ)のみ。
// レビュー付きトイレが十分増えたら、そのサブセットだけを載せるチャンクを追加する(その際はここを動的計算に戻す)。

// 1 トイレチャンク = 4 ロケール × この件数 ≈ 4 倍の URL(Google 上限 50,000 未満になるよう 11,000)。
// 現在はトイレチャンクを生成しないので未使用だが、再開時の基準値として残す。
export const SITEMAP_CHUNK_TOILETS = 11_000;

// 返り値 = sitemap 総数。id 0 = 静的ページ + エリアページ。
export async function sitemapChunkCount(): Promise<number> {
  return 1;
}
