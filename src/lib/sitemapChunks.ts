// sitemap の分割数を sitemap.ts と robots.ts で一致させるための共有ロジック。
//
// sitemap には indexable サブセット(canonical predicate, 設計書 §5.1)のトイレだけを載せる。
// id 0 = 静的ページ + 全エリアページ、id 1.. = indexable トイレ個別ページ(4 ロケール × チャンク件数)。
// indexable 母集団が増えれば自動でチャンク数が増える(ただし generateSitemaps はビルド時にチャンク数を
// 確定するので、大規模シード後はチャンク数再計算のため再デプロイが必要 = R4)。

import { getIndexableToiletCount } from "@/lib/toilets";

// 1 トイレチャンク = 4 ロケール × この件数 ≈ 4 倍の URL(Google 上限 50,000 未満になるよう 11,000)。
// 根拠: 50,000 / 4 locale = 12,500、余裕を見て 11,000(AC3)。
export const SITEMAP_CHUNK_TOILETS = 11_000;

// 返り値 = sitemap 総数。id 0 = 静的ページ + エリアページ(常に存在するので最低 1)。
// id 1.. = indexable トイレチャンク = ceil(indexableCount / SITEMAP_CHUNK_TOILETS)。
// 注意: getIndexableToiletCount は失敗時 0 フォールバックなので、RPC(migration 007)未適用や
// Supabase 障害時は build が通って 1 チャンク固定になる(自動回復しない)。期待 N>0 のはずが
// build 時に 0 なら deploy しないこと(設計書 §5.1 / PROGRESS 5.1 の適用順序ゲート)。
export async function sitemapChunkCount(): Promise<number> {
  const count = await getIndexableToiletCount();
  if (count <= 0) return 1; // チャンク0(静的+area)は常に存在
  return 1 + Math.ceil(count / SITEMAP_CHUNK_TOILETS);
}
