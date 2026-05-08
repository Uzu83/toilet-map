"use client";

import { Baby, Droplets, Heart, X } from "lucide-react";
import { useMapStore, type Filters } from "@/store/mapStore";

type Chip = { key: keyof Filters; label: string; icon: React.ReactNode };

const CHIPS: Chip[] = [
  { key: "washlet", label: "ウォシュレット", icon: <Droplets className="h-3.5 w-3.5" /> },
  { key: "diaperTable", label: "おむつ替え", icon: <Baby className="h-3.5 w-3.5" /> },
  { key: "universal", label: "ユニバーサル", icon: <span aria-hidden>♿</span> },
  { key: "favoritesOnly", label: "お気に入り", icon: <Heart className="h-3.5 w-3.5" /> },
];

export function FilterBar({ visibleCount }: { visibleCount: number }) {
  const filters = useMapStore((s) => s.filters);
  const toggleFilter = useMapStore((s) => s.toggleFilter);
  const resetFilters = useMapStore((s) => s.resetFilters);
  const anyOn = Object.values(filters).some(Boolean);

  return (
    <div className="absolute inset-x-0 top-0 z-1000 px-2 pt-2">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-1.5 rounded-full bg-white/95 px-2 py-1.5 shadow-md ring-1 ring-black/5 backdrop-blur dark:bg-zinc-900/95 dark:ring-white/10">
        {CHIPS.map((c) => {
          const active = filters[c.key];
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggleFilter(c.key)}
              aria-pressed={active}
              className={
                active
                  ? "flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm"
                  : "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }
            >
              {c.icon}
              {c.label}
            </button>
          );
        })}
        <span className="ml-auto pr-1 text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
          {visibleCount}件
        </span>
        {anyOn && (
          <button
            type="button"
            onClick={resetFilters}
            aria-label="フィルタをリセット"
            className="rounded-full p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
