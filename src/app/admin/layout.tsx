import type { Metadata } from "next";
// globals.css は [locale] 配下にあるが、Tailwind のベース/ユーティリティはそこで定義されている。
// admin は [locale] の外にある独立 root layout なので、ここでも同じ globals.css を読み込んで
// Tailwind を効かせる(WHY: admin 専用に CSS を二重管理しないため)。
import "../[locale]/globals.css";

// WHY force-dynamic + no-store: 管理画面の HTML を静的生成・キャッシュさせない。
//   proxy のゲートにすり抜けがあっても、ビルド時に出力された管理 HTML が CDN から
//   そのまま配られる事故を防ぐ(常にリクエスト毎にサーバで描画 → 各 route/page でも cookie 再検証)。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "管理 | Loo map",
  // 管理画面は検索インデックス対象外(運営専用)。
  robots: { index: false, follow: false },
};

// /admin は [locale] の外に置く運営専用ルート。i18n は不要なので日本語固定の root layout を持つ。
// この layout が html/body を提供する(=このサブツリー独自の root layout)。
export default function AdminRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        {children}
      </body>
    </html>
  );
}
