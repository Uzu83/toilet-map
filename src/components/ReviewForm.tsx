"use client";

import { useState } from "react";
import { Star, X } from "lucide-react";
import { ACCESS_LEVELS, type AccessLevel } from "@/types/toilet";

type Props = {
  toiletId: string;
  toiletName: string | null;
  onClose: () => void;
};

export function ReviewForm({ toiletId, toiletName, onClose }: Props) {
  const [rating, setRating] = useState(0);
  const [accessLevel, setAccessLevel] = useState<AccessLevel | null>(null);
  const [hasWashlet, setHasWashlet] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (rating === 0 || !accessLevel) {
      setError("星と「許可」を選んでください");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toiletId, rating, accessLevel, hasWashlet, comment }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "投稿に失敗しました");
      return;
    }
    setDone(true);
    setTimeout(onClose, 1200);
  };

  return (
    <div className="fixed inset-0 z-2000 flex items-end justify-center bg-black/50 p-2 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              評価する
            </h3>
            <p className="text-xs text-zinc-500">{toiletName ?? "名称未設定のトイレ"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <p className="rounded-lg bg-emerald-50 p-4 text-center text-sm text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
            ありがとうございます!投稿を受け付けました。
          </p>
        ) : (
          <>
            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                清潔度
              </legend>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    aria-label={`${n}星`}
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
                利用許可
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(ACCESS_LEVELS) as AccessLevel[]).map((k) => {
                  const meta = ACCESS_LEVELS[k];
                  const active = accessLevel === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setAccessLevel(k)}
                      className="flex flex-col items-center gap-1 rounded-lg border-2 p-3 text-xs font-medium transition"
                      style={{
                        borderColor: active ? meta.color : "transparent",
                        backgroundColor: active ? `${meta.color}10` : "var(--color-muted, #f4f4f5)",
                        color: active ? meta.color : "#52525b",
                      }}
                    >
                      <span
                        className="h-5 w-5 rounded-full"
                        style={{ backgroundColor: meta.color }}
                      />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                ウォシュレット
              </legend>
              <div className="flex gap-2">
                {[
                  { v: true, label: "あり" },
                  { v: false, label: "なし" },
                  { v: null, label: "わからない" },
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
                コメント (任意・500文字以内)
              </legend>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="例: ベビーカーで入れる、24時間利用可、など"
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
              {submitting ? "送信中…" : "送信する"}
            </button>
            <p className="mt-2 text-center text-xs text-zinc-400">
              同じトイレへの投稿は1時間に1回までです
            </p>
          </>
        )}
      </div>
    </div>
  );
}
