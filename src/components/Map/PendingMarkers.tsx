"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

import { useMapStore } from "@/store/mapStore";
import { makePendingPinIcon } from "./pinIcon";

// pending(未承認のユーザー申請)を薄色ピンで描画する。クラスタには入れず、
// 既存トイレピンと視覚的に区別する。タップで追認(「ここにトイレがある」)確認モーダルを開く。
export function PendingMarkers() {
  const map = useMap();
  const pending = useMapStore((s) => s.pendingSubmissions);
  const addMode = useMapStore((s) => s.addMode);
  const setConfirmTarget = useMapStore((s) => s.setConfirmTarget);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const group = L.layerGroup();
    layerRef.current = group;
    map.addLayer(group);
    return () => {
      map.removeLayer(group);
      layerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const group = layerRef.current;
    if (!group) return;
    group.clearLayers();
    // addMode 中は中央ピン操作の邪魔になるので pending ピンは隠す
    if (addMode) return;
    for (const s of pending) {
      const marker = L.marker([s.lat, s.lng], {
        icon: makePendingPinIcon({ confirmCount: s.confirm_count }),
        zIndexOffset: -100,
      });
      marker.on("click", () => {
        setConfirmTarget({ id: s.id, lat: s.lat, lng: s.lng, name: s.name });
      });
      group.addLayer(marker);
    }
  }, [pending, addMode, setConfirmTarget]);

  return null;
}
