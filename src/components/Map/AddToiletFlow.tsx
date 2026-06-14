"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, MapPin, Plus, X } from "lucide-react";
import { ACCESS_COLORS, ACCESS_KEYS, type AccessLevel } from "@/types/toilet";
import { useMapStore } from "@/store/mapStore";
import { trackEvent } from "@/lib/analytics";

type SubmitResult = {
  result?: "pending" | "promoted" | "dup" | "throttled";
  error?: string;
};

// トイレ追加申請フロー(Phase 2, 中央ピン方式)。
//  1) FAB「トイレを追加」→ addMode on
//  2) 中央固定ピンを位置合わせ →「この位置にする」
//  3) 申請フォーム(name/access/屋外/多目的/補足)→ POST /api/submissions
// pending ピンのタップ追認(confirmTarget)は ConfirmPendingModal(別マウント)で処理する。
export function AddToiletFlow() {
  const t = useTranslations("addToilet");
  const ta = useTranslations("access");

  const addMode = useMapStore((s) => s.addMode);
  const setAddMode = useMapStore((s) => s.setAddMode);
  const addDraft = useMapStore((s) => s.addDraft);
  const select = useMapStore((s) => s.select);
  const bumpData = useMapStore((s) => s.bumpData);
  const confirmTarget = useMapStore((s) => s.confirmTarget);
  const setConfirmTarget = useMapStore((s) => s.setConfirmTarget);

  const [step, setStep] = useState<"pick" | "form">("pick");
  const [accessLevel, setAccessLevel] = useState<AccessLevel | null>(null);
  const [name, setName] = useState("");
  const [isOutdoor, setIsOutdoor] = useState<boolean | null>(null);
  const [isUniversal, setIsUniversal] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  // addMode へは startAdd 経由でしか入らないため、ここで初期化すれば effect は不要。
  const startAdd = () => {
    select(null); // 開いている PinSheet を閉じる
    setConfirmTarget(null);
    setStep("pick");
    setAccessLevel(null);
    setName("");
    setIsOutdoor(null);
    setIsUniversal(null);
    setComment("");
    setError(null);
    setDoneMsg(null);
    setAddMode(true);
    trackEvent("add_toilet_start");
  };

  const submit = async () => {
    if (!accessLevel) {
      setError(t("errAccess"));
      return;
    }
    if (!addDraft) {
      setError(t("errLocation"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lat: addDraft.lat,
          lng: addDraft.lng,
          accessLevel,
          name: name.trim() || undefined,
          isOutdoor,
          isUniversal,
          comment: comment.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as SubmitResult;
      setSubmitting(false);
      if (res.status === 409 || j.result === "dup") {
        setError(t("dup"));
        return;
      }
      if (res.status === 429 || j.result === "throttled") {
        setError(t("throttled"));
        return;
      }
      if (!res.ok) {
        setError(j.error ?? t("errSubmit"));
        return;
      }
      trackEvent("add_toilet_submit", { result: j.result ?? "pending" });
      setDoneMsg(j.result === "promoted" ? t("thanksPromoted") : t("thanksPending"));
      bumpData();
      setTimeout(() => setAddMode(false), 1600);
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : t("errSubmit"));
    }
  };

  // ── 追認モーダル(pending ピンのタップ) ──────────────────────────
  if (confirmTarget) {
    return (
      <ConfirmPendingModal
        target={confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onConfirmed={bumpData}
      />
    );
  }

  // ── 申請フォーム(位置確定後) ─────────────────────────────────
  if (addMode && step === "form") {
    return (
      <div className="fixed inset-0 z-2000 flex items-end justify-center bg-black/50 p-2 sm:items-center sm:p-4">
        <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              {t("title")}
            </h3>
            <button
              type="button"
              onClick={() => setAddMode(false)}
              aria-label={t("close")}
              className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {doneMsg ? (
            <p className="rounded-lg bg-emerald-50 p-4 text-center text-sm text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
              {doneMsg}
            </p>
          ) : (
            <>
              <fieldset className="mb-4">
                <legend className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  {t("name")}
                </legend>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 120))}
                  placeholder={t("namePlaceholder")}
                  className="w-full rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </fieldset>

              <fieldset className="mb-4">
                <legend className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  {t("access")}
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

              <BoolToggle
                label={t("isOutdoor")}
                yes={t("yes")}
                no={t("no")}
                value={isOutdoor}
                onChange={setIsOutdoor}
              />
              <BoolToggle
                label={t("isUniversal")}
                yes={t("yes")}
                no={t("no")}
                value={isUniversal}
                onChange={setIsUniversal}
              />

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

              <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{t("warning")}</p>
              {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep("pick")}
                  className="h-12 flex-1 rounded-lg border border-zinc-300 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {t("back")}
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  className="h-12 flex-[2] rounded-lg bg-indigo-600 text-base font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting ? t("submitting") : t("submit")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── 位置選択(中央固定ピン + 下部バー) ───────────────────────────
  if (addMode && step === "pick") {
    return (
      <>
        {/* 中央固定ピン(地図の中心に重ねる。pointer-events none で地図操作を透過) */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-1000 -translate-x-1/2 -translate-y-full">
          <MapPin className="h-10 w-10 fill-indigo-600/30 text-indigo-600 drop-shadow" />
        </div>
        <div className="absolute inset-x-0 bottom-0 z-1000 flex flex-col gap-2 bg-gradient-to-t from-black/60 to-transparent p-4 pt-10">
          <p className="text-center text-sm font-medium text-white drop-shadow">{t("hint")}</p>
          <div className="mx-auto flex w-full max-w-md gap-2">
            <button
              type="button"
              onClick={() => setAddMode(false)}
              className="h-12 flex-1 rounded-lg bg-white/90 text-sm font-semibold text-zinc-700 shadow hover:bg-white"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={() => setStep("form")}
              className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-lg bg-indigo-600 text-base font-semibold text-white shadow hover:bg-indigo-700"
            >
              <Check className="h-5 w-5" />
              {t("confirmLocation")}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── FAB「トイレを追加」 ──────────────────────────────────────
  return (
    <button
      type="button"
      onClick={startAdd}
      className="absolute bottom-24 right-4 z-1000 flex h-12 items-center gap-2 rounded-full bg-indigo-600 px-4 text-sm font-semibold text-white shadow-lg hover:bg-indigo-700"
    >
      <Plus className="h-5 w-5" />
      {t("entry")}
    </button>
  );
}

// pending ピンの追認モーダル。confirmTarget が set されるたびに新規マウントされるので
// submitting/error/doneMsg は毎回クリーンな状態から始まる(stale state を避ける)。
function ConfirmPendingModal({
  target,
  onClose,
  onConfirmed,
}: {
  target: { id: string; lat: number; lng: number; name: string | null };
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const t = useTranslations("addToilet");
  const tp = useTranslations("pinSheet");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const confirmExisting = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // 追認は「ここにトイレがある」の表明。access は新規 pending 作成時のみ使われ、
      // 既存 pending への confirm 経路では無視されるため open を既定で送る。
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: target.lat, lng: target.lng, accessLevel: "open" }),
      });
      const j = (await res.json().catch(() => ({}))) as SubmitResult;
      setSubmitting(false);
      if (res.status === 429 || j.result === "throttled") {
        setError(t("throttled"));
        return;
      }
      if (!res.ok && res.status !== 409) {
        setError(j.error ?? t("errSubmit"));
        return;
      }
      trackEvent("add_toilet_confirm", { result: j.result ?? "pending" });
      setDoneMsg(j.result === "promoted" ? t("thanksPromoted") : t("thanksPending"));
      onConfirmed();
      setTimeout(onClose, 1600);
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : t("errSubmit"));
    }
  };

  return (
    <div className="fixed inset-0 z-2000 flex items-end justify-center bg-black/50 p-2 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
                {t("pendingBadge")}
              </span>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                {t("pendingConfirm")}
              </h3>
            </div>
            <p className="text-xs text-zinc-500">{target.name ?? tp("unnamed")}</p>
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
        {doneMsg ? (
          <p className="rounded-lg bg-emerald-50 p-4 text-center text-sm text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
            {doneMsg}
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">{t("warning")}</p>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <button
              type="button"
              onClick={confirmExisting}
              disabled={submitting}
              className="h-12 w-full rounded-lg bg-indigo-600 text-base font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? t("submitting") : t("pendingConfirm")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function BoolToggle({
  label,
  yes,
  no,
  value,
  onChange,
}: {
  label: string;
  yes: string;
  no: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {label}
      </legend>
      <div className="flex gap-2">
        {[
          { v: true, label: yes },
          { v: false, label: no },
        ].map((o) => (
          <button
            key={String(o.v)}
            type="button"
            onClick={() => onChange(value === o.v ? null : o.v)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
              value === o.v
                ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200"
                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
