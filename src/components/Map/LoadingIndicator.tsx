"use client";

import { Loader2 } from "lucide-react";
import { useMapStore } from "@/store/mapStore";

export function LoadingIndicator() {
  const loading = useMapStore((s) => s.loading);
  if (!loading) return null;
  return (
    <div className="absolute right-3 top-28 z-1000 flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] text-zinc-600 shadow ring-1 ring-black/5 dark:bg-zinc-900/95 dark:text-zinc-300 dark:ring-white/10">
      <Loader2 className="h-3 w-3 animate-spin" />
      読み込み中
    </div>
  );
}
