"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useMapStore } from "@/store/mapStore";
import { ToiletList } from "./ToiletList";
import { ErrorBoundary } from "../ErrorBoundary";

function MapLoading() {
  const t = useTranslations("map");
  return (
    <div className="grid h-full w-full place-items-center bg-zinc-50 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
      {t("loading")}
    </div>
  );
}

// Leaflet は window / document に依存するため SSR 不可。
// `next/dynamic` の `ssr: false` は Client Component 内でのみ使えるため、
// このラッパーで吸収して Server Component から呼び出せるようにする。
const ToiletMap = dynamic(() => import("./ToiletMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

export default function ClientToiletMap() {
  const t = useTranslations("errorBoundary");
  const view = useMapStore((s) => s.view);
  const loadFavorites = useMapStore((s) => s.loadFavorites);
  const loadFilters = useMapStore((s) => s.loadFilters);
  useEffect(() => {
    loadFavorites();
    loadFilters();
  }, [loadFavorites, loadFilters]);
  return (
    <ErrorBoundary
      labels={{
        title: t("title"),
        hint: t("hint"),
        retry: t("retry"),
        home: t("home"),
      }}
    >
      {view === "list" ? <ToiletList /> : <ToiletMap />}
    </ErrorBoundary>
  );
}
