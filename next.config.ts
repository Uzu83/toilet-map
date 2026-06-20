import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // 管理系(運営専用・非公開)のレスポンスをブラウザ/CDN/中間プロキシにキャッシュさせない。
  // WHY: export const dynamic = "force-dynamic" は Next 自身の static 生成/Full Route Cache を抑止するだけで
  //   Cache-Control ヘッダは出さない。/admin の HTML(モデレーション情報を含む Server Component ページ)が
  //   共有端末の bfcache/ディスクキャッシュに残らないよう、ここでヘッダを「実体化」する。
  //   API ルートは個別に noStore() でも付与しているが、ここでも一括で被覆して取りこぼしを防ぐ(多層防御)。
  async headers() {
    return [
      {
        source: "/admin/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
      {
        source: "/api/admin/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  disableLogger: true,
});
