"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ACCESS_COLORS, ACCESS_KEYS } from "@/types/toilet";

export function PinLegend() {
  const t = useTranslations("legend");
  const ta = useTranslations("access");
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute bottom-4 left-3 z-1000">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-t-lg bg-white/95 px-2 py-1 text-[11px] font-semibold text-zinc-600 shadow ring-1 ring-black/5 dark:bg-zinc-900/95 dark:text-zinc-300 dark:ring-white/10"
      >
        {t("title")}
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>
      {open && (
        <div className="rounded-r-lg rounded-bl-lg bg-white/95 p-2 text-[11px] shadow-md ring-1 ring-black/5 dark:bg-zinc-900/95 dark:ring-white/10">
          {ACCESS_KEYS.map((k) => (
            <div key={k} className="flex items-center gap-2 py-0.5">
              <span
                className="h-3 w-3 shrink-0 rounded-full ring-1 ring-zinc-300/70"
                style={{ backgroundColor: ACCESS_COLORS[k] }}
              />
              <span className="text-zinc-700 dark:text-zinc-200">{ta(`${k}.label`)}</span>
            </div>
          ))}
          <div className="mt-1 flex items-center gap-2 border-t border-zinc-200/70 pt-1 dark:border-zinc-700/70">
            <span className="h-3 w-3 shrink-0 rounded-full bg-zinc-400 ring-1 ring-zinc-300/70" />
            <span className="text-zinc-500">{t("unranked")}</span>
          </div>
          <div className="flex items-center gap-2 py-0.5">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: "transparent", border: "2px dashed #3B82F6" }}
            />
            <span className="text-zinc-500">{t("inferred")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
