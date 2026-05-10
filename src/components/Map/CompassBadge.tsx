"use client";

import { useTranslations } from "next-intl";
import { Compass } from "lucide-react";

export function CompassBadge() {
  const t = useTranslations("map");
  return (
    <div
      aria-label={t("northBadge")}
      className="absolute right-3 top-14 z-1000 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-zinc-700 shadow ring-1 ring-black/10 dark:bg-zinc-900/95 dark:text-zinc-200 dark:ring-white/10"
    >
      <Compass className="h-5 w-5" />
      <span className="sr-only">{t("northBadge")}</span>
    </div>
  );
}
