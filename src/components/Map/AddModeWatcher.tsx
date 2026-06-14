"use client";

import { useEffect } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import { useMapStore } from "@/store/mapStore";

// addMode 中、地図中心(=中央固定ピンが指す座標)を store.addDraft に同期する。
// MapContainer 内に置く必要がある(useMap を使うため)。中央ピンの描画自体は
// 外側オーバーレイ(AddToiletFlow)が CSS で行う。
export function AddModeWatcher() {
  const map = useMap();
  const addMode = useMapStore((s) => s.addMode);
  const setAddDraft = useMapStore((s) => s.setAddDraft);

  // addMode に入った瞬間の中心を初期値として入れる
  useEffect(() => {
    if (!addMode) return;
    const c = map.getCenter();
    setAddDraft({ lat: c.lat, lng: c.lng });
  }, [addMode, map, setAddDraft]);

  useMapEvents({
    move: () => {
      if (!useMapStore.getState().addMode) return;
      const c = map.getCenter();
      setAddDraft({ lat: c.lat, lng: c.lng });
    },
  });

  return null;
}
