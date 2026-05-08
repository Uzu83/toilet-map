import Link from "next/link";
import ClientToiletMap from "@/components/Map/ClientToiletMap";
import { OnboardingCard } from "@/components/OnboardingCard";
import { BottomTabBar } from "@/components/BottomTabBar";

export default function HomePage() {
  return (
    <div className="flex h-dvh w-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <h1 className="text-base font-bold tracking-tight text-blue-600">
          🚽 ピットイン
        </h1>
        <nav className="flex gap-3 text-xs text-zinc-500">
          <Link href="/contact" className="hover:text-zinc-900 dark:hover:text-zinc-200">
            ご意見
          </Link>
          <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-200">
            プライバシー
          </Link>
          <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-200">
            規約
          </Link>
        </nav>
      </header>
      <main className="relative flex-1 pb-14">
        <ClientToiletMap />
      </main>
      <BottomTabBar />
      <OnboardingCard />
    </div>
  );
}
