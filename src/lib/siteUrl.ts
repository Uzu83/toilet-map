// 本番/プレビュー/開発で適切な site URL を返す。
// 優先順位: NEXT_PUBLIC_SITE_URL → Vercel 環境(VERCEL_PROJECT_PRODUCTION_URL/VERCEL_URL) → ローカル
export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  // Production: 自動で取得できる(Vercel が注入)
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  // Preview / branch deploy
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}
