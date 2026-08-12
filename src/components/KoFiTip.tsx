"use client";

import { useTranslations } from "next-intl";
import { KO_FI_URL } from "@/lib/contact";
import { trackEvent } from "@/lib/analytics";

type KoFiTipSource = "toilet" | "about" | "area";

export function KoFiTip({ source }: { source: KoFiTipSource }) {
  const t = useTranslations("kofi");

  return (
    <aside className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
      <p>{t("message")}</p>
      <a
        href={KO_FI_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackEvent("ko_fi_click", { source })}
        className="mt-1 inline-flex min-h-11 items-center font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
      >
        ☕ {t("cta")}
      </a>
    </aside>
  );
}
