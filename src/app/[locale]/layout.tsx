import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { VercelAnalytics } from "@/components/VercelAnalytics";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/siteUrl";
import { StructuredData } from "@/components/StructuredData";
import { baseOpenGraph } from "@/lib/urls";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  const base = siteUrl();
  const path = locale === routing.defaultLocale ? "" : `/${locale}`;
  return {
    metadataBase: new URL(base),
    title: { default: t("title"), template: `%s | Loo map` },
    description: t("description"),
    applicationName: "Loo map",
    manifest: "/manifest.json",
    appleWebApp: { capable: true, statusBarStyle: "default", title: "Loo map" },
    alternates: {
      canonical: `${base}${path}`,
      languages: {
        ja: base,
        en: `${base}/en`,
        ko: `${base}/ko`,
        zh: `${base}/zh`,
        "x-default": base,
      },
    },
    openGraph: {
      ...baseOpenGraph(locale),
      title: t("title"),
      description: t("description"),
      url: `${base}${path}`,
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
    },
    robots: { index: true, follow: true },
    verification: { google: "hHdNAnGirkxFJ9QvjPGe6o1exoJVEAYuDEUaQPRxvS8" },
  };
}

export const viewport: Viewport = {
  themeColor: "#3B82F6",
  width: "device-width",
  initialScale: 1,
  // WHY (maximumScale を指定しない = ユーザーのピンチズームを許可):
  //   以前は maximumScale:1 でページ全体の拡大を禁止していたが、これは WCAG 1.4.4
  //   (Resize Text)違反。低視力ユーザーが PinSheet・フォーム・法務ページの文字を
  //   ブラウザのピンチで拡大できなかった。地図自体のズームは Leaflet が .leaflet-container
  //   内のジェスチャを自前で処理するため、UA のページズームを開放しても二重ズームにはならない
  //   (Codex 異モデルレビューで確認済み)。⚠️ a11y 退行になるので maximumScale/userScalable を
  //   再び足さないこと。
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full overscroll-none bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        <NextIntlClientProvider>
          {children}
          <StructuredData />
        </NextIntlClientProvider>
        <VercelAnalytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
