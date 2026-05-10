import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/siteUrl";
import { StructuredData } from "@/components/StructuredData";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const OG_LOCALE: Record<string, string> = {
  ja: "ja_JP",
  en: "en_US",
  ko: "ko_KR",
  zh: "zh_CN",
};

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
      title: t("title"),
      description: t("description"),
      type: "website",
      locale: OG_LOCALE[locale] ?? "ja_JP",
      siteName: "Loo map",
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
  maximumScale: 1,
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
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
