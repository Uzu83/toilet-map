"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Heart, MapPin, MessageSquarePlus, X } from "lucide-react";

const STORAGE_KEY = "toilet-map.onboarding.dismissed";

const subscribe = () => () => {};
const getServer = () => true; // SSR は表示しない(後でハイドレートで判定)
const getClient = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

export function OnboardingCard() {
  const dismissedFromStorage = useSyncExternalStore(subscribe, getClient, getServer);
  const [localDismissed, setLocalDismissed] = useState(false);
  const dismissed = dismissedFromStorage || localDismissed;

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Safari プライベートモード等
    }
    setLocalDismissed(true);
  }, []);

  if (dismissed) return null;

  return (
    <div className="fixed inset-0 z-2000 flex items-end justify-center bg-black/50 p-2 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
            🚽 ピットインへようこそ
          </h2>
          <button
            type="button"
            onClick={dismiss}
            aria-label="閉じる"
            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          近くの公衆トイレを 3 タップ以内で見つけよう。
        </p>

        <ul className="mb-5 space-y-2.5 text-sm">
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
              色
            </span>
            <span className="text-zinc-700 dark:text-zinc-200">
              <b className="text-blue-600">青</b>=声かけ不要 /{" "}
              <b className="text-amber-600">黄</b>=一声かけて /{" "}
              <b className="text-red-600">赤</b>=要許可
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
            <span className="text-zinc-700 dark:text-zinc-200">
              ピンタップで詳細・距離・「ここに行く」ナビ
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <MessageSquarePlus className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            <span className="text-zinc-700 dark:text-zinc-200">
              使った後に評価/「ない」報告で次の人を救おう
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Heart className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
            <span className="text-zinc-700 dark:text-zinc-200">
              よく行く場所はお気に入りに保存
            </span>
          </li>
        </ul>

        <div className="mb-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          ※ 一部のピンは推定情報。実際と異なる場合は「使えなかった」報告にご協力ください。
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="h-12 w-full rounded-lg bg-blue-600 text-base font-semibold text-white shadow hover:bg-blue-700"
        >
          始める
        </button>
      </div>
    </div>
  );
}
