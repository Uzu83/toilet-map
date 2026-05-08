"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useMapStore } from "@/store/mapStore";
import { ToiletList } from "./ToiletList";
import { ErrorBoundary } from "../ErrorBoundary";

// Leaflet は window / document に依存するため SSR 不可。
// `next/dynamic` の `ssr: false` は Client Component 内でのみ使えるため、
// このラッパーで吸収して Server Component から呼び出せるようにする。
const ToiletMap = dynamic(() => import("./ToiletMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-zinc-50 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
      地図を読み込み中…
    </div>
  ),
});

export default function ClientToiletMap() {
  const view = useMapStore((s) => s.view);
  const loadFavorites = useMapStore((s) => s.loadFavorites);
  const loadFilters = useMapStore((s) => s.loadFilters);
  useEffect(() => {
    loadFavorites();
    loadFilters();
  }, [loadFavorites, loadFilters]);
  return (
    <ErrorBoundary>{view === "list" ? <ToiletList /> : <ToiletMap />}</ErrorBoundary>
  );
}
