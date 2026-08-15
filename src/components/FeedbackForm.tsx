"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  FEEDBACK_KINDS,
  submitFeedback,
  type ToiletFeedbackKind,
} from "@/lib/feedback/client";
import { CONTACT_FORM_URL } from "@/lib/contact";

export function FeedbackForm() {
  const t = useTranslations("contact");
  const [kind, setKind] = useState<ToiletFeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const disabled = busy || sent;

  const mapError = (code: string): string => {
    if (code === "empty") return t("errorEmpty");
    if (code === "unavailable" || code === "network") return t("errorSend");
    return code;
  };

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    setFallbackUrl(null);
    try {
      const result = await submitFeedback({ kind, message });
      if (result.ok) {
        setSent(true);
        return;
      }
      setError(mapError(result.error));
      if (result.fallbackUrl) setFallbackUrl(result.fallbackUrl);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <p
        role="status"
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
      >
        {t("success")}
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("privacyNote")}</p>

      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {t("kindLabel")}
        <select
          value={kind}
          disabled={disabled}
          onChange={(e) => setKind(e.target.value as ToiletFeedbackKind)}
          className="mt-1 min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        >
          {FEEDBACK_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {t("messageLabel")}
        <textarea
          value={message}
          disabled={disabled}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          required
          maxLength={2000}
          placeholder={t("messagePlaceholder")}
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
      </label>

      {error && (
        <div className="flex flex-col gap-2" role="status">
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          {fallbackUrl && (
            <a
              href={fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            >
              <ExternalLink className="h-4 w-4" />
              {t("openForm")}
            </a>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={disabled || !message.trim()}
        className="flex h-12 w-full items-center justify-center rounded-lg bg-blue-600 text-base font-semibold text-white shadow hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? t("sending") : t("submit")}
      </button>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t("formFallbackNote")}{" "}
        <a
          href={CONTACT_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          {t("openForm")}
        </a>
      </p>
    </form>
  );
}
