"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { parseMapViewQuery } from "@/lib/mapViewQuery";
import { useMapStore } from "@/store/mapStore";
import type { Toilet } from "@/types/toilet";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function markDeepLinkMissing() {
  useMapStore.getState().setNotice({ kind: "deepLinkMissing" });
}

// 1) URL に ?id=<uuid> があれば該当ピンへ flyTo + select。失敗・不正は無言で消さず案内。
// 2) id が無ければ ?lat=&lng=&zoom= でエリア中心へ flyTo。
// 3) selectedId 変化時に URL を ?id=<uuid> / なし に同期
export function DeepLinkResolver() {
  const map = useMap();
  const select = useMapStore((s) => s.select);
  const setToilets = useMapStore((s) => s.setToilets);
  const selectedId = useMapStore((s) => s.selectedId);
  const resolvedRef = useRef(false);
  const prevSelectedRef = useRef<string | null>(null);

  useEffect(() => {
    if (resolvedRef.current) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get("id");
    if (id !== null) {
      resolvedRef.current = true;
      if (!id || !UUID_RE.test(id)) {
        markDeepLinkMissing();
        return;
      }
      void (async () => {
        try {
          const res = await fetch(`/api/toilets/${id}`, { cache: "no-store" });
          if (!res.ok) {
            markDeepLinkMissing();
            return;
          }
          const json = (await res.json()) as { toilet?: Toilet };
          const t = json.toilet;
          if (!t) {
            markDeepLinkMissing();
            return;
          }
          setToilets([t]);
          map.flyTo([t.lat, t.lng], 16, { duration: 0.6 });
          setTimeout(() => select(t.id), 200);
        } catch {
          markDeepLinkMissing();
        }
      })();
      return;
    }

    const view = parseMapViewQuery(url.searchParams);
    resolvedRef.current = true;
    if (view) {
      map.flyTo([view.lat, view.lng], view.zoom, { duration: 0.6 });
    }
  }, [map, select, setToilets]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const current = url.searchParams.get("id");
    if (selectedId && current !== selectedId) {
      url.searchParams.set("id", selectedId);
      window.history.replaceState({}, "", url.toString());
    } else if (!selectedId && prevSelectedRef.current && current) {
      // ユーザーがピンを閉じたときだけ ?id= を外す。
      // 無効 id の初回マウントでは selectedId がずっと null なので、ここを通すと
      // 案内を出す前に URL が無言でトップ化してしまう。
      url.searchParams.delete("id");
      window.history.replaceState({}, "", url.toString());
    }
    prevSelectedRef.current = selectedId;
  }, [selectedId]);

  return null;
}
