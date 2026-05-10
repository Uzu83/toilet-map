"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ExternalLink, Heart, MessageSquarePlus, Share2, Star, X } from "lucide-react";
import { useMapStore } from "@/store/mapStore";
import { ACCESS_COLORS, effectiveAccess, isUnconfirmed } from "@/types/toilet";
import { bearingDeg, bearingIndex, formatDistance, haversineMeters } from "@/lib/geo";
import { trackEvent } from "@/lib/analytics";
import { ReviewForm } from "../ReviewForm";

export function PinSheet() {
  const t = useTranslations("pinSheet");
  const ta = useTranslations("access");
  const tc = useTranslations("compass");
  const selectedId = useMapStore((s) => s.selectedId);
  const select = useMapStore((s) => s.select);
  const toilets = useMapStore((s) => s.toilets);
  const userPos = useMapStore((s) => s.userPos);
  const favorites = useMapStore((s) => s.favorites);
  const toggleFavorite = useMapStore((s) => s.toggleFavorite);
  const [reviewMode, setReviewMode] = useState<"normal" | "report" | null>(null);
  const [shared, setShared] = useState(false);

  const toilet = useMemo(
    () => toilets.find((t) => t.id === selectedId) ?? null,
    [toilets, selectedId]
  );
  if (!toilet) return null;

  const distInfo = userPos
    ? (() => {
        const m = haversineMeters(userPos, toilet);
        const idx = bearingIndex(bearingDeg(userPos, toilet));
        return `${formatDistance(m)} ${tc(String(idx))}${t("directionSuffix")}`;
      })()
    : null;

  const access = effectiveAccess(toilet);
  const accessColor = access ? ACCESS_COLORS[access] : null;
  const accessLabel = access ? ta(`${access}.label`) : null;
  const unconfirmed = isUnconfirmed(toilet);
  const isInferred = toilet.source === "inferred" && toilet.review_count === 0;
  const fav = favorites.has(toilet.id);
  const mapsHref = `https://www.google.com/maps/dir/?api=1&destination=${toilet.lat},${toilet.lng}`;
  const name = toilet.name ?? t("unnamed");

  const onShare = async () => {
    const shareTitle = toilet.name ?? t("shareDefault");
    const accessSuffix = accessLabel ? ` (${accessLabel})` : "";
    const shareUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/?id=${toilet.id}`
        : `/?id=${toilet.id}`;
    const shareText = `${shareTitle}${accessSuffix}\n${shareUrl}`;

    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
        trackEvent("pin_share", { toiletId: toilet.id, method: "native" });
        return;
      } catch {
        // ユーザーキャンセル等
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setShared(true);
      trackEvent("pin_share", { toiletId: toilet.id, method: "clipboard" });
      setTimeout(() => setShared(false), 1500);
    } catch {
      // 何もできない環境
    }
  };

  return (
    <>
      <div className="absolute inset-x-0 bottom-0 z-1000 mx-auto w-full max-w-md rounded-t-2xl bg-white p-4 pb-6 shadow-2xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-zinc-900 dark:text-zinc-50">{name}</h2>
            {distInfo && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{distInfo}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => toggleFavorite(toilet.id)}
              aria-pressed={fav}
              aria-label={fav ? t("favoriteRemove") : t("favoriteAdd")}
              className="rounded-full p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Heart className={fav ? "h-5 w-5 fill-rose-500 text-rose-500" : "h-5 w-5 text-zinc-400"} />
            </button>
            <button
              type="button"
              onClick={onShare}
              aria-label={t("share")}
              className="relative rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Share2 className="h-5 w-5" />
              {shared && (
                <span className="absolute -bottom-6 right-0 whitespace-nowrap rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white shadow">
                  {t("copied")}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => select(null)}
              aria-label={t("close")}
              className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {accessColor && accessLabel ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: accessColor }}
            >
              {accessLabel}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {t("noRating")}
            </span>
          )}
          {isInferred && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              {t("unconfirmed")}
            </span>
          )}
          {toilet.has_washlet && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
              {t("washlet")}
            </span>
          )}
          {toilet.has_diaper_table && (
            <span className="rounded-full bg-pink-100 px-2.5 py-1 text-xs font-medium text-pink-800 dark:bg-pink-900/40 dark:text-pink-200">
              {t("diaperTable")}
            </span>
          )}
          {toilet.is_universal && (
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
              {t("universal")}
            </span>
          )}
        </div>

        {isInferred && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {toilet.opening_hours
                ? t("inferredNoteWithHours", { hours: toilet.opening_hours })
                : t("inferredNoteNoHours")}
            </p>
          </div>
        )}

        <div className="mb-4 flex items-center gap-2 text-sm">
          <Stars value={toilet.avg_rating ?? 0} />
          <span className="text-zinc-700 dark:text-zinc-300">
            {toilet.avg_rating ? toilet.avg_rating.toFixed(1) : "—"}
          </span>
          <span className="text-zinc-400">
            ({t("reviewCount", { count: toilet.review_count })}
            {unconfirmed && toilet.review_count > 0 ? ` · ${t("ratingNote")}` : ""})
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-12 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white shadow hover:bg-blue-700 active:scale-95"
          >
            <ExternalLink className="h-4 w-4" />
            {t("goHere")}
          </a>
          <button
            type="button"
            onClick={() => setReviewMode("normal")}
            className="flex h-12 items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white shadow hover:bg-emerald-700 active:scale-95"
          >
            <MessageSquarePlus className="h-4 w-4" />
            {t("review")}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setReviewMode("report")}
          className="mt-2 w-full text-xs text-zinc-500 underline-offset-2 hover:text-red-600 hover:underline"
        >
          {t("report")}
        </button>
      </div>

      {reviewMode && (
        <ReviewForm
          toiletId={toilet.id}
          toiletName={toilet.name}
          mode={reviewMode}
          onClose={() => setReviewMode(null)}
        />
      )}
    </>
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
              ? "h-4 w-4 fill-amber-400 text-amber-400"
              : "h-4 w-4 text-zinc-300 dark:text-zinc-600"
          }
        />
      ))}
    </div>
  );
}
