"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "toilet-map.install.dismissed";
const SHOW_DELAY_MS = 25_000;

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // ignore
    }
    if (dismissed) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // 25 秒後にプロンプト表示(早すぎず、十分に使ってもらった後)
    const t = setTimeout(() => setShow(true), SHOW_DELAY_MS);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      clearTimeout(t);
    };
  }, []);

  if (!deferred || !show) return null;

  const dismiss = (persist = true) => {
    if (persist) {
      try {
        localStorage.setItem(DISMISSED_KEY, "1");
      } catch {
        // ignore
      }
    }
    setShow(false);
    setDeferred(null);
  };

  const install = async () => {
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      // 成否に関わらずプロンプトは消し、accept/dismiss を localStorage に記録
      dismiss(outcome === "accepted");
    } catch {
      dismiss();
    }
  };

  return (
    <div className="fixed bottom-20 right-3 z-1000 flex items-center gap-2 rounded-full bg-blue-600 py-2 pl-3 pr-1.5 text-sm font-semibold text-white shadow-xl">
      <Download className="h-4 w-4" />
      <button type="button" onClick={install}>
        ホーム画面に追加
      </button>
      <button
        type="button"
        onClick={() => dismiss()}
        aria-label="閉じる"
        className="rounded-full p-1 hover:bg-white/15"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
