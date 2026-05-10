"use client";

import { useTranslations } from "next-intl";
import { List, Map as MapIcon } from "lucide-react";
import { useMapStore, type View } from "@/store/mapStore";

const TABS: { key: View; icon: React.ReactNode }[] = [
  { key: "map", icon: <MapIcon className="h-5 w-5" /> },
  { key: "list", icon: <List className="h-5 w-5" /> },
];

export function BottomTabBar() {
  const t = useTranslations("tab");
  const view = useMapStore((s) => s.view);
  const setView = useMapStore((s) => s.setView);
  const selectedId = useMapStore((s) => s.selectedId);

  // PinSheet が出ている時はかぶるので非表示
  if (selectedId) return null;

  return (
    <nav
      aria-label={t("switchView")}
      className="fixed inset-x-0 bottom-0 z-1000 mx-auto flex max-w-md justify-around border-t border-zinc-200/70 bg-white/95 px-2 py-1 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0) + 4px)" }}
    >
      {TABS.map((tab) => {
        const active = view === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => setView(tab.key)}
            aria-pressed={active}
            className={
              active
                ? "flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-blue-600"
                : "flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-zinc-500"
            }
          >
            {tab.icon}
            <span className="text-[10px] font-semibold">{t(tab.key)}</span>
          </button>
        );
      })}
    </nav>
  );
}
