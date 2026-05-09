"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { useMapStore } from "@/store/mapStore";

// mapStore.flyToTarget が立っていればその座標へ flyTo してクリア。
// リスト→マップ切替や、外部 API 経由でマップを動かしたいときに使う。
export function FlyToWatcher() {
  const map = useMap();
  const target = useMapStore((s) => s.flyToTarget);
  const setTarget = useMapStore((s) => s.setFlyToTarget);

  useEffect(() => {
    if (!target) return;
    map.flyTo([target.lat, target.lng], target.zoom ?? 17, { duration: 0.6 });
    setTarget(null);
  }, [target, map, setTarget]);

  return null;
}
