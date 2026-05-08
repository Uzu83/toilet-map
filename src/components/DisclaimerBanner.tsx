"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Info, X } from "lucide-react";

const STORAGE_KEY = "toilet-map.disclaimer.dismissed";

// SSR/CSR で安全に localStorage を読むための useSyncExternalStore 用ヘルパ
const subscribe = () => () => {};
const getServerSnapshot = () => false; // SSR: dismissed=false (まだ判定不可)
const getClientSnapshot = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

export function DisclaimerBanner() {
  const dismissedFromStorage = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot
  );
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
    <div className="flex shrink-0 items-start gap-2 border-b border-blue-200/70 bg-blue-50/90 px-3 py-2 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1 leading-relaxed">
        ※ 本サービスのトイレ情報には推定や古いデータを含む場合があります。実際と異なる場合は「ここは使えなかった」報告にご協力ください。
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="バナーを閉じる"
        className="-mt-0.5 -mr-1 rounded-full p-1 text-blue-700/80 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/60"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
