import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import ClientToiletMap from "@/components/Map/ClientToiletMap";
import { OnboardingCard } from "@/components/OnboardingCard";
import { BottomTabBar } from "@/components/BottomTabBar";
import { InstallPrompt } from "@/components/InstallPrompt";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { KO_FI_URL } from "@/lib/contact";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("nav");

  return (
    <div className="flex h-dvh w-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
        <h1 className="text-base font-bold tracking-tight text-blue-600">
          🚽 Loo map
        </h1>
        <nav className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-zinc-500">
          <Link href="/contact" className="hover:text-zinc-900 dark:hover:text-zinc-200">
            {t("feedback")}
          </Link>
          <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-200">
            {t("privacy")}
          </Link>
          <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-200">
            {t("terms")}
          </Link>
          <Link href="/about" className="hover:text-zinc-900 dark:hover:text-zinc-200">
            {t("about")}
          </Link>
          <a
            href={KO_FI_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-900 dark:hover:text-zinc-200"
          >
            ☕ {t("support")}
          </a>
          <LocaleSwitcher />
        </nav>
      </header>
      <main className="relative flex-1 pb-14">
        <ClientToiletMap />
      </main>
      <BottomTabBar />
      <OnboardingCard />
      <InstallPrompt />
    </div>
  );
}
