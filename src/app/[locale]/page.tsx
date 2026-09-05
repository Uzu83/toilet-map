import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import ClientToiletMap from "@/components/Map/ClientToiletMap";
import { OnboardingCard } from "@/components/OnboardingCard";
import { BottomTabBar } from "@/components/BottomTabBar";
import { InstallPrompt } from "@/components/InstallPrompt";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { KoFiHeaderLink } from "@/components/KoFiHeaderLink";
import { findArea, areaLabel, FEATURED_AREA_SLUGS } from "@/lib/areas";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("nav");
  const tApp = await getTranslations("app");
  const tan = await getTranslations("areaNames");
  const featuredAreas = FEATURED_AREA_SLUGS.map((s) => findArea(s)).filter(
    (a): a is NonNullable<typeof a> => !!a
  );

  return (
    <div className="flex h-dvh w-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
        <h1 className="text-base font-bold tracking-tight text-blue-600">
          🚽 Loo map
        </h1>
        {/* #39 — SSR タグライン。クローラへの最低限のテキストコンテンツを提供する。
             map が JS で描画されるためトップページのクロール可能 HTML は空に近い。
             sr-only は使わない(display:none / clip はクローラが読む可能性があるため、
             意味あるコンテンツには通常 text として置く)。
             テキスト色を薄く小さくして視覚的に目立たせず、ヘッダ行に収めて 3 タップ UX を守る。 */}
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          {tApp("tagline")}
        </p>
        {/*
          WHY (inline-flex min-h-11 items-center の理由 / B1 タップ領域 + #13 SSRタグライン統合):
            旧実装はテキストリンクのみ(text-xs 行高 ≈ 16px)で実寸タップ領域が 16px 前後。
            WCAG 2.5.5 の 44px 目安を大幅に下回り、特にモバイルの片手操作で誤タップが多発する。
            inline-flex + min-h-11(44px) + items-center でタップ領域を確保しつつ、
            視覚的テキストサイズ(text-xs)とヘッダの高さ(shrink-0)に影響を与えない。
            gap-x / gap-y はリンク間隔であり当たり判定には影響しないが、
            タップ後の隣接ターゲットへの誤ジャンプを防ぐため gap-x-1 gap-y-0 に絞める。
            gap-x を大きくすると縦折り返し時に横幅が溢れるので flex-wrap + justify-end で吸収する。
        */}
        <nav className="flex flex-wrap items-center justify-end gap-x-1 gap-y-0 text-xs text-zinc-500">
          <Link href="/contact" className="inline-flex min-h-11 items-center px-2 hover:text-zinc-900 dark:hover:text-zinc-200">

            {t("feedback")}
          </Link>
          <Link href="/privacy" className="inline-flex min-h-11 items-center px-2 hover:text-zinc-900 dark:hover:text-zinc-200">
            {t("privacy")}
          </Link>
          <Link href="/terms" className="inline-flex min-h-11 items-center px-2 hover:text-zinc-900 dark:hover:text-zinc-200">
            {t("terms")}
          </Link>
          <Link href="/about" className="inline-flex min-h-11 items-center px-2 hover:text-zinc-900 dark:hover:text-zinc-200">
            {t("about")}
          </Link>
          <KoFiHeaderLink
            label={t("support")}
            className="inline-flex min-h-11 items-center px-2 hover:text-zinc-900 dark:hover:text-zinc-200"
          />
          <LocaleSwitcher />
        </nav>
      </header>
      {/* WHY flex column + min-h-0: map is h-full; without this the area strip sits
          below the viewport and Leaflet steals scroll (Codex P2). */}
      <main className="relative flex min-h-0 flex-1 flex-col pb-14">
        <div className="relative min-h-0 flex-1">
          <ClientToiletMap />
        </div>
        <nav
          aria-label={tApp("popularAreas")}
          className="z-10 shrink-0 border-t border-zinc-200 bg-white/95 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/95 dark:text-zinc-400"
        >
          <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">{tApp("popularAreas")}</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {featuredAreas.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/area/${a.slug}`}
                  className="inline-flex min-h-9 items-center underline-offset-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-200"
                >
                  {areaLabel(a, tan)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <BottomTabBar />
      <OnboardingCard />
      <InstallPrompt />
    </div>
  );
}
