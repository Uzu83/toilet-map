import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { siteUrl } from "@/lib/siteUrl";
import { StructuredData } from "@/components/StructuredData";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Loo map - 近くのトイレを最速で見つける地図",
    template: "%s | Loo map",
  },
  description:
    "近くの公衆トイレを「許可不要(青)・声かけ要(黄)・許可要(赤)」のピンと星1-5の清潔度で3タップ以内に探せる地図。福岡市から順次全国へ。",
  applicationName: "Loo map",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Loo map",
  },
  openGraph: {
    title: "Loo map - 近くのトイレを最速で見つける地図",
    description: "ピン色と星評価で、3タップ以内に最適なトイレを。",
    type: "website",
    locale: "ja_JP",
    siteName: "Loo map",
  },
  twitter: {
    card: "summary_large_image",
    title: "Loo map - 近くのトイレを最速で見つける地図",
    description: "ピン色と星評価で、3タップ以内に最適なトイレを。",
  },
  robots: {
    index: true,
    follow: true,
  },
  verification: {
    google: "hHdNAnGirkxFJ9QvjPGe6o1exoJVEAYuDEUaQPRxvS8",
  },
};

export const viewport: Viewport = {
  themeColor: "#3B82F6",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full overscroll-none bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        {children}
        <StructuredData />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
