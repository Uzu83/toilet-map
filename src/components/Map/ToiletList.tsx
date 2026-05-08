"use client";

import { useMemo } from "react";
import { Heart, MapPin, Star } from "lucide-react";
import {
  ACCESS_LEVELS,
  effectiveAccess,
  isUnconfirmed,
  type Toilet,
} from "@/types/toilet";
import { applyFilters, useMapStore } from "@/store/mapStore";
import { bearingDeg, compassLabel, formatDistance, haversineMeters } from "@/lib/geo";
import { FilterBar } from "./FilterBar";

const HAKATA_STATION = { lat: 33.5904, lng: 130.4204 };

export function ToiletList() {
  const toilets = useMapStore((s) => s.toilets);
  const filters = useMapStore((s) => s.filters);
  const favorites = useMapStore((s) => s.favorites);
  const userPos = useMapStore((s) => s.userPos);
  const select = useMapStore((s) => s.select);
  const setView = useMapStore((s) => s.setView);
  const toggleFavorite = useMapStore((s) => s.toggleFavorite);
  const loading = useMapStore((s) => s.loading);

  const origin = userPos ?? HAKATA_STATION;

  const items = useMemo(() => {
    const filtered = applyFilters(toilets, filters, favorites);
    return filtered
      .map((t) => ({
        toilet: t,
        distance: haversineMeters(origin, t),
        bearing: bearingDeg(origin, t),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 100);
  }, [toilets, filters, favorites, origin]);

  const onTap = (t: Toilet) => {
    select(t.id);
    setView("map");
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <FilterBar visibleCount={items.length} />
      <div className="h-full overflow-y-auto pb-24 pt-16">
        {items.length === 0 && loading ? (
          <ul className="mx-auto max-w-2xl divide-y divide-zinc-200/70 px-2 dark:divide-zinc-800">
            {Array.from({ length: 6 }).map((_, i) => (
              <li
                key={i}
                className="flex animate-pulse items-center gap-3 px-2 py-3"
              >
                <div className="h-9 w-9 shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/2 rounded bg-zinc-200 dark:bg-zinc-800" />
                  <div className="h-2 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800" />
                </div>
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <div className="mx-auto mt-10 max-w-sm rounded-2xl bg-white p-6 text-center shadow ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
            <MapPin className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              条件に合うトイレが近くにありません
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              フィルタを外す/マップで別のエリアに移動してください
            </p>
          </div>
        ) : (
          <ul className="mx-auto max-w-2xl divide-y divide-zinc-200/70 px-2 dark:divide-zinc-800">
            {items.map(({ toilet, distance, bearing }) => {
              const access = effectiveAccess(toilet);
              const accessMeta = access ? ACCESS_LEVELS[access] : null;
              const inferred = toilet.source === "inferred" && toilet.review_count === 0;
              const fav = favorites.has(toilet.id);
              return (
                <li key={toilet.id}>
                  <button
                    type="button"
                    onClick={() => onTap(toilet)}
                    className="flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-white dark:hover:bg-zinc-900"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow"
                      style={{
                        backgroundColor: accessMeta?.color ?? "#9CA3AF",
                        opacity: inferred ? 0.6 : 1,
                        border: inferred ? "2px dashed #fff" : undefined,
                      }}
                    >
                      <MapPin className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {toilet.name ?? "名称未設定のトイレ"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {formatDistance(distance)} {compassLabel(bearing)}方向
                        {accessMeta && <> ・ {accessMeta.label}</>}
                        {inferred && <> ・ ※未確認</>}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1">
                        <Stars value={toilet.avg_rating ?? 0} />
                        <span className="text-[10px] text-zinc-500 tabular-nums">
                          {toilet.avg_rating ? toilet.avg_rating.toFixed(1) : "—"}
                          ({toilet.review_count})
                          {isUnconfirmed(toilet) && toilet.review_count > 0 && " ※参考値"}
                        </span>
                      </div>
                    </div>
                    <span
                      role="button"
                      aria-pressed={fav}
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(toilet.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleFavorite(toilet.id);
                        }
                      }}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Heart
                        className={
                          fav
                            ? "h-4 w-4 fill-rose-500 text-rose-500"
                            : "h-4 w-4 text-zinc-400"
                        }
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={
            i <= Math.round(value)
              ? "h-3 w-3 fill-amber-400 text-amber-400"
              : "h-3 w-3 text-zinc-300 dark:text-zinc-600"
          }
        />
      ))}
    </div>
  );
}
