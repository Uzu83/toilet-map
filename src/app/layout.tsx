import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { siteUrl } from "@/lib/siteUrl";
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
    default: "ピットイン - 近くのトイレ専用地図アプリ",
    template: "%s | ピットイン",
  },
  description:
    "近くの公衆トイレを「許可不要(青)・声かけ要(黄)・許可要(赤)」のピンと星1-5の清潔度で3タップ以内に探せる地図アプリ。",
  applicationName: "ピットイン",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ピットイン",
  },
  openGraph: {
    title: "ピットイン - 近くのトイレ専用地図アプリ",
    description: "ピン色と星評価で、3タップ以内に最適なトイレを。",
    type: "website",
    locale: "ja_JP",
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
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
