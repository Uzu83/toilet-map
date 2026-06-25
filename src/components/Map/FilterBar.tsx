"use client";

import { useTranslations } from "next-intl";
import { Baby, Droplets, Heart, X } from "lucide-react";
import { useMapStore, type Filters } from "@/store/mapStore";

type Chip = { key: keyof Filters; icon: React.ReactNode };

const CHIPS: Chip[] = [
  { key: "washlet", icon: <Droplets className="h-3.5 w-3.5" /> },
  { key: "diaperTable", icon: <Baby className="h-3.5 w-3.5" /> },
  { key: "universal", icon: <span aria-hidden>♿</span> },
  { key: "favoritesOnly", icon: <Heart className="h-3.5 w-3.5" /> },
];

export function FilterBar({ visibleCount }: { visibleCount: number }) {
  const t = useTranslations("filter");
  const filters = useMapStore((s) => s.filters);
  const toggleFilter = useMapStore((s) => s.toggleFilter);
  const resetFilters = useMapStore((s) => s.resetFilters);
  const anyOn = Object.values(filters).some(Boolean);

  return (
    <div className="absolute inset-x-0 top-0 z-1000 px-2 pt-2">
      <div className="scrollbar-none mx-auto flex max-w-2xl items-center gap-1.5 overflow-x-auto whitespace-nowrap rounded-full bg-white/95 px-2 py-1.5 shadow-md ring-1 ring-black/5 backdrop-blur dark:bg-zinc-900/95 dark:ring-white/10 md:flex-wrap md:overflow-visible md:whitespace-normal">
        {CHIPS.map((c) => {
          const active = filters[c.key];
          return (
            /*
              WHY (min-h-11 + py-2.5 の理由):
                旧実装 py-1 = 上下 4px × 2 + アイコン/テキスト高 ≈ 24px → 44px 目安を大幅に下回る。
                py-2.5(10px×2) + フォント行高 ≈ 44px に到達。
                横幅はコンテナに入りきる範囲で min-w-11 も付けて保証。
                視覚の文字サイズ(text-xs)と丸み(rounded-full)は変えない。
            */
            <button
              key={c.key}
              type="button"
              onClick={() => toggleFilter(c.key)}
              aria-pressed={active}
              className={
                active
                  ? "inline-flex min-h-11 min-w-11 items-center gap-1 rounded-full bg-blue-600 px-2.5 py-2.5 text-xs font-medium text-white shadow-sm"
                  : "inline-flex min-h-11 min-w-11 items-center gap-1 rounded-full px-2.5 py-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }
            >
              {c.icon}
              {t(c.key)}
            </button>
          );
        })}
        <span className="ml-auto shrink-0 pr-1 text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
          {t("count", { count: visibleCount })}
        </span>
        {anyOn && (
          /*
            WHY (min-h-11 min-w-11 + inline-flex):
              リセット × ボタンも 44px タップ領域に合わせる。
              p-1 → inline-flex + min-h/w-11 + items-center + justify-center で視覚サイズを変えずに達成。
          */
          <button
            type="button"
            onClick={resetFilters}
            aria-label={t("reset")}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
