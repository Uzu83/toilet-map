"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  Heart,
  Info,
  MessageSquarePlus,
  Share2,
  Star,
  X,
} from "lucide-react";
import { routing } from "@/i18n/routing";
import { useMapStore } from "@/store/mapStore";
import { ACCESS_COLORS, effectiveAccess, isUnconfirmed } from "@/types/toilet";
import { bearingDeg, bearingIndex, formatDistance, haversineMeters } from "@/lib/geo";
import { is24h } from "@/lib/openingHours";
import { trackEvent } from "@/lib/analytics";
import { ReviewForm } from "../ReviewForm";

export function PinSheet() {
  const t = useTranslations("pinSheet");
  const ta = useTranslations("access");
  const tc = useTranslations("compass");
  // 使い方ガイドのコピーは onboarding.etiquette* を再利用する。
  // WHY: 既に ja/en/ko/zh の 4 言語に翻訳済みの単一ソース。pinSheet 側に複製すると
  //      将来どちらかだけ直されて文言がドリフトするので、新規キーを作らず流用する。
  const to = useTranslations("onboarding");
  const locale = useLocale();
  const selectedId = useMapStore((s) => s.selectedId);
  const select = useMapStore((s) => s.select);
  const toilets = useMapStore((s) => s.toilets);
  const userPos = useMapStore((s) => s.userPos);
  const favorites = useMapStore((s) => s.favorites);
  const toggleFavorite = useMapStore((s) => s.toggleFavorite);
  const [reviewMode, setReviewMode] = useState<"normal" | "report" | null>(null);
  const [shared, setShared] = useState(false);
  // 使い方ガイド <details> の開閉状態。
  // WHY (初期値が「非 ja のとき open」の根拠):
  //   日本在住(ja)はトイレのマナーが既知なので畳んでノイズを減らす。
  //   訪日外国人想定(en/ko/zh)は LIXIL 調査で約 47% が操作ボタンを理解できないため、
  //   既定で開いて摩擦を下げる。既に開いた詳細シート内の付加情報なので 3 タップ動線は阻害しない。
  // WHY (open を prop で毎レンダー渡しせず state にする理由):
  //   native <details> に open prop を毎レンダー渡すと、お気に入り/共有などの state 変更で
  //   PinSheet が再レンダーされたとき、ユーザーが一度閉じたガイドが再び開いてしまう。
  //   onToggle で DOM の開閉を state に同期し、ユーザー操作を尊重する(初期値のみ上記ロジック)。
  const [guideOpen, setGuideOpen] = useState(locale !== routing.defaultLocale);

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
  // WHY (なぜ &origin= を付けないのか / 将来 AI への警告):
  //   Google Maps の dir/?api=1 は origin 未指定だとデバイスのライブ現在地を起点に採用する。
  //   ここで Loo map の userPos(GPS 取得時点で固定され、移動すると陳腐化しうる)を &origin= に
  //   注入すると、かえって古い起点のルートになり改悪になる。親切心で origin を足さないこと。
  const mapsHref = `https://www.google.com/maps/dir/?api=1&destination=${toilet.lat},${toilet.lng}`;
  const name = toilet.name ?? t("unnamed");

  const onShare = async () => {
    const shareTitle = toilet.name ?? t("shareDefault");
    const accessSuffix = accessLabel ? ` (${accessLabel})` : "";
    const localePrefix = locale === routing.defaultLocale ? "" : `/${locale}`;
    const shareUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}${localePrefix}/toilet/${toilet.id}`
        : `${localePrefix}/toilet/${toilet.id}`;
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
      {/*
        WHY (max-h-[85vh] overflow-y-auto):
          営業時間行 + 使い方ガイド(非 ja は既定オープン)で内容が増え、小型モバイルでは
          ボトムシートが画面外へ伸びて上部見出しや操作ボタン(ここに行く/評価)が見切れる。
          シートを画面高の 85% に制限し、超過分はシート内スクロールにすることで、
          詳細量に依らず「ピンタップ → 詳細 → 行動」の 3 タップ動線を常に維持する。
      */}
      <div className="absolute inset-x-0 bottom-0 z-1000 mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 pb-6 shadow-2xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10">
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
          {/*
            24時間バッジ。is24h は正準形 `24/7` のみ true(接尾辞・例外付きは false → 営業時間行で生表示)。
            色は sky 系で washlet(emerald)/diaper(pink)/universal(violet)と視覚的に区別する。
            推定ピン(isInferred)でも 24h なら従来の警告は別途出るが、24h はバッジで足りる
            ため重複しない(営業時間「行」は下で isInferred を除外している)。
          */}
          {is24h(toilet.opening_hours) && (
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
              {t("open24h")}
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

        {/*
          営業時間行。表示条件 = !isInferred && opening_hours あり && !is24h。
          WHY (!isInferred ガード):
            isInferred =(source==="inferred" && review_count===0)。このピンは上の推定警告
            ブロック(inferredNoteWithHours)内で既に営業時間を表示済みなので、ここで再掲すると
            二重表示になる。「非推定」は単なる source!=="inferred" ではなく isInferred が false の意。
          WHY (!is24h ガード):
            24h のときは上のバッジで「24時間」と示しており、'24/7' を営業時間行に出しても情報量がない。
          break-words / [overflow-wrap:anywhere]: OSM の opening_hours は長い構文文字列(例
            'Mo-Fr 09:00-17:00; Sa 10:00-15:00')になり得るため、シート幅を超えないよう折り返す。
        */}
        {!isInferred && toilet.opening_hours && !is24h(toilet.opening_hours) && (
          <div className="mb-4 flex items-start gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-words [overflow-wrap:anywhere]">
              {t("openingHoursLabel")}: {toilet.opening_hours}
            </span>
          </div>
        )}

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

        {/*
          日本のトイレ使い方ガイド(折り畳み)。
          コピーは onboarding.etiquette* を再利用(上の to フックの WHY 参照)。
          open は state(guideOpen)制御で、onToggle で DOM 開閉を state に同期する
          (再レンダーでユーザーが閉じたガイドが勝手に開かないように。guideOpen の WHY 参照)。
        */}
        <details
          open={guideOpen}
          onToggle={(e) => setGuideOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800"
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded text-xs font-medium text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-300">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {to("etiquetteTitle")}
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-600 dark:text-zinc-400">
            <li>{to("etiquetteSit")}</li>
            <li>{to("etiquettePaper")}</li>
            <li>{to("etiquetteFlush")}</li>
            <li>{to("etiquetteNoStand")}</li>
          </ul>
        </details>
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
