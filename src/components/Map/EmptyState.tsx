"use client";

import { useTranslations } from "next-intl";
import { Search, ZoomOut } from "lucide-react";

export function EmptyState({ filtered }: { filtered: boolean }) {
  const t = useTranslations("map");
  return (
    // SearchBar は top-16 + min-h-11。カードの pointer-events-auto が検索入力を奪わないようその下へ。
    <div className="pointer-events-none absolute inset-x-0 top-[calc(4rem+2.75rem+0.5rem)] z-1000 mx-auto max-w-sm px-4">
      {/* pointer-events-none: カードに操作はない。auto だと検索サジェストのタップを奪う。 */}
      <div className="rounded-2xl bg-white/95 p-4 text-center shadow-lg ring-1 ring-black/5 backdrop-blur dark:bg-zinc-900/95 dark:ring-white/10">
        {filtered ? (
          <>
            <Search className="mx-auto mb-1 h-5 w-5 text-zinc-400" />
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {t("emptyFiltered")}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{t("emptyFilteredHint")}</p>
          </>
        ) : (
          <>
            <ZoomOut className="mx-auto mb-1 h-5 w-5 text-zinc-400" />
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {t("emptyArea")}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{t("emptyAreaHint")}</p>
          </>
        )}
      </div>
    </div>
  );
}
