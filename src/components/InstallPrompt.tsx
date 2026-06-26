"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Download, Share, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "toilet-map.install.dismissed";
// [B7] WHY SHOW_DELAY_MS = 25_000 (25秒) か:
//   インストールプロンプトを「即表示」すると、ユーザーがアプリの価値を体験する前に
//   「ホームに追加する?」と聞かれて邪魔と感じる → PWA 承認率が大幅に下がる(UX 研究の知見)。
//   25 秒はユーザーが「マップを見て、ピンをタップして、最初のトイレ情報を確認する」のに
//   十分な時間として設定した。短すぎる(5 秒)と価値体験前の割り込みになり、
//   長すぎる(60 秒)とほとんどのユーザーがページを離れた後になる(特にモバイル滞在時間中央値 考慮)。
//   ⚠️ この値を小さくすると承認率が下がる可能性が高いので、A/B データなしで変えないこと。
const SHOW_DELAY_MS = 25_000;

const subscribe = () => () => {};
const getServer = () => false;
const getClientDismissed = () => {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
};
const getClientIsIos = () => {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
  if (!isIos) return false;
  const standalone =
    "standalone" in window.navigator &&
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
};

export function InstallPrompt() {
  const t = useTranslations("install");
  const dismissedFromStorage = useSyncExternalStore(
    subscribe,
    getClientDismissed,
    getServer
  );
  const isIos = useSyncExternalStore(subscribe, getClientIsIos, getServer);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [localDismissed, setLocalDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (dismissedFromStorage) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const t = setTimeout(() => setShow(true), SHOW_DELAY_MS);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      clearTimeout(t);
    };
  }, [dismissedFromStorage]);

  const dismissed = dismissedFromStorage || localDismissed;
  if (dismissed || !show) return null;

  const dismiss = (persist = true) => {
    if (persist) {
      try {
        localStorage.setItem(DISMISSED_KEY, "1");
      } catch {
        // ignore
      }
    }
    setLocalDismissed(true);
    setDeferred(null);
  };

  // iOS は Safari/Chrome ともに beforeinstallprompt 非対応のため、共有メニューからの手動手順を案内
  if (isIos && !deferred) {
    return (
      <div className="fixed bottom-20 left-3 right-3 z-1000 mx-auto flex max-w-sm items-start gap-2 rounded-2xl bg-zinc-900/95 px-3 py-2.5 text-xs text-white shadow-xl">
        <Share className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
        <p className="flex-1 leading-relaxed">{t("iosHint")}</p>
        <button
          type="button"
          onClick={() => dismiss()}
          aria-label={t("close")}
          className="-mr-1 -mt-1 rounded-full p-1 hover:bg-white/15"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (!deferred) return null;

  const install = async () => {
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      dismiss(outcome === "accepted");
    } catch {
      dismiss();
    }
  };

  return (
    <div className="fixed bottom-20 right-3 z-1000 flex items-center gap-2 rounded-full bg-blue-600 py-2 pl-3 pr-1.5 text-sm font-semibold text-white shadow-xl">
      <Download className="h-4 w-4" />
      <button type="button" onClick={install}>
        {t("addToHome")}
      </button>
      <button
        type="button"
        onClick={() => dismiss()}
        aria-label={t("close")}
        className="rounded-full p-1 hover:bg-white/15"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
