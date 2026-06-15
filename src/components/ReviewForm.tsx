"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Star, X } from "lucide-react";
import { ACCESS_COLORS, ACCESS_KEYS, type AccessLevel } from "@/types/toilet";
import { trackEvent } from "@/lib/analytics";

type Mode = "normal" | "report";
type Props = {
  toiletId: string;
  toiletName: string | null;
  mode: Mode;
  onClose: () => void;
};

export function ReviewForm({ toiletId, toiletName, mode, onClose }: Props) {
  const t = useTranslations("review");
  const ta = useTranslations("access");
  const tp = useTranslations("pinSheet");
  const [rating, setRating] = useState(0);
  const [accessLevel, setAccessLevel] = useState<AccessLevel | null>(null);
  const [hasWashlet, setHasWashlet] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const isReport = mode === "report";
  const displayName = toiletName ?? tp("unnamed");

  const submit = async () => {
    if (!isReport && (rating === 0 || !accessLevel)) {
      if (rating === 0 && !accessLevel) {
        setError(t("errBoth"));
      } else if (rating === 0) {
        setError(t("errStarOnly"));
      } else {
        setError(t("errAccessOnly"));
      }
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload = isReport
      ? { toiletId, notAToilet: true, comment }
      : { toiletId, rating, accessLevel, hasWashlet, comment };
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? t("errSubmit"));
      return;
    }
    setDone(true);
    trackEvent(isReport ? "report_submit" : "review_submit", {
      toiletId,
      ...(isReport ? {} : { rating, accessLevel }),
    });
    setTimeout(onClose, 1400);
  };

  return (
    <div className="fixed inset-0 z-2000 flex items-end justify-center bg-black/50 p-2 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              {isReport ? t("titleReport") : t("titleNormal")}
            </h3>
            <p className="text-xs text-zinc-500">{displayName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <p className="rounded-lg bg-emerald-50 p-4 text-center text-sm text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
            {t("thanks")}
          </p>
        ) : isReport ? (
          <>
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{t("reportWarning")}</p>
            </div>
            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                {t("reportStatus")}
              </legend>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                rows={3}
                placeholder={t("reportPlaceholder")}
                className="w-full resize-none rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
            </fieldset>

            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="h-12 w-full rounded-lg bg-red-600 text-base font-semibold text-white shadow hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? t("submitting") : t("reportSubmit")}
            </button>
            <p className="mt-2 text-center text-xs text-zinc-400">{t("rateLimit")}</p>
          </>
        ) : (
          <>
            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                {t("cleanliness")}
              </legend>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    aria-label={t("starN", { n })}
                    className="rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Star
                      className={
                        n <= rating
                          ? "h-8 w-8 fill-amber-400 text-amber-400"
                          : "h-8 w-8 text-zinc-300 dark:text-zinc-600"
                      }
                    />
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                {t("accessPermission")}
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {ACCESS_KEYS.map((k) => {
                  const active = accessLevel === k;
                  const color = ACCESS_COLORS[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setAccessLevel(k)}
                      className="flex flex-col items-center gap-1 rounded-lg border-2 p-3 text-xs font-medium transition"
                      style={{
                        borderColor: active ? color : "transparent",
                        backgroundColor: active ? `${color}10` : "var(--color-muted, #f4f4f5)",
                        color: active ? color : "#52525b",
                      }}
                    >
                      <span className="h-5 w-5 rounded-full" style={{ backgroundColor: color }} />
                      {ta(`${k}.label`)}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                {t("washletQ")}
              </legend>
              <div className="flex gap-2">
                {[
                  { v: true, label: t("yes") },
                  { v: false, label: t("no") },
                  { v: null, label: t("unknown") },
                ].map((o) => (
                  <button
                    key={String(o.v)}
                    type="button"
                    onClick={() => setHasWashlet(o.v)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                      hasWashlet === o.v
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                        : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                {t("comment")}
              </legend>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                rows={3}
                placeholder={t("commentPlaceholder")}
                className="w-full resize-none rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
            </fieldset>

            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="h-12 w-full rounded-lg bg-blue-600 text-base font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? t("submitting") : t("submit")}
            </button>
            <p className="mt-2 text-center text-xs text-zinc-400">{t("rateLimit")}</p>
          </>
        )}
      </div>
    </div>
  );
}
