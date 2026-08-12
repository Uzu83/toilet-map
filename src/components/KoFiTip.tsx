"use client";

import { useTranslations } from "next-intl";
import { KO_FI_URL } from "@/lib/contact";
import { trackEvent } from "@/lib/analytics";

type KoFiTipSource = "toilet" | "about" | "area";

export function KoFiTip({ source }: { source: KoFiTipSource }) {
  const t = useTranslations("kofi");

  return (
    <aside className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
      <p>{t("message")}</p>
      <a
        href={KO_FI_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackEvent("ko_fi_click", { source })}
        className="mt-2 flex h-12 w-full items-center justify-center rounded-lg border border-zinc-300 bg-white text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:w-auto sm:px-4"
      >
        ☕ {t("cta")}
      </a>
    </aside>
  );
}
