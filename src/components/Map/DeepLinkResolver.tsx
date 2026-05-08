"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { useMapStore } from "@/store/mapStore";
import type { Toilet } from "@/types/toilet";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 1) URL に ?id=<uuid> があれば該当ピンへ flyTo + select
// 2) selectedId 変化時に URL を ?id=<uuid> / なし に同期
export function DeepLinkResolver() {
  const map = useMap();
  const select = useMapStore((s) => s.select);
  const setToilets = useMapStore((s) => s.setToilets);
  const selectedId = useMapStore((s) => s.selectedId);
  const resolvedRef = useRef(false);

  // 初回マウント: ?id があれば fetch → flyTo → select
  useEffect(() => {
    if (resolvedRef.current) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get("id");
    if (!id || !UUID_RE.test(id)) {
      resolvedRef.current = true;
      return;
    }
    resolvedRef.current = true;
    void (async () => {
      try {
        const res = await fetch(`/api/toilets/${id}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { toilet?: Toilet };
        const t = json.toilet;
        if (!t) return;
        // 既存配列に追加(後続の bbox 取得が来ても、この toilet は bbox 内にあるので含まれる)
        setToilets([t]);
        map.flyTo([t.lat, t.lng], 16, { duration: 0.6 });
        // flyTo が完了する前でも selectedId を立てておく(到着後 PinSheet が開く)
        setTimeout(() => select(t.id), 200);
      } catch {
        // ignore
      }
    })();
  }, [map, select, setToilets]);

  // selectedId 変化時に URL 同期
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const current = url.searchParams.get("id");
    if (selectedId && current !== selectedId) {
      url.searchParams.set("id", selectedId);
      window.history.replaceState({}, "", url.toString());
    } else if (!selectedId && current) {
      url.searchParams.delete("id");
      window.history.replaceState({}, "", url.toString());
    }
  }, [selectedId]);

  return null;
}
