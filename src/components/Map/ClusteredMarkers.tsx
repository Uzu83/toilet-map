"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

import { effectiveAccess, isUnconfirmed, isInferredPin, type Toilet } from "@/types/toilet";
import { makePinIcon } from "./pinIcon";

type Props = {
  toilets: Toilet[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function ClusteredMarkers({ toilets, selectedId, onSelect }: Props) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);

  // クラスタグループの生成・破棄
  useEffect(() => {
    const group = L.markerClusterGroup({
      maxClusterRadius: 60,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 17, // ズーム 17+ ではクラスタ解除して個別ピン
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        const size = count < 10 ? 36 : count < 50 ? 42 : 50;
        return L.divIcon({
          html: `
<div style="
  width:${size}px;height:${size}px;border-radius:50%;
  background:rgba(59,130,246,.85);color:#fff;
  display:flex;align-items:center;justify-content:center;
  font-weight:700;font-size:${count < 100 ? 13 : 11}px;
  box-shadow:0 2px 6px rgba(0,0,0,.3);
  border:2px solid rgba(255,255,255,.9);
">${count}</div>`,
          className: "toilet-cluster",
          iconSize: [size, size],
        });
      },
    });
    groupRef.current = group;
    map.addLayer(group);
    return () => {
      map.removeLayer(group);
      groupRef.current = null;
    };
  }, [map]);

  // toilets / selectedId 変更時にマーカー再構築。
  // 選択中ピンを最後に追加して z-index で前面表示。
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    let selectedMarker: L.Marker | null = null;
    for (const t of toilets) {
      const isSelected = t.id === selectedId;
      const marker = L.marker([t.lat, t.lng], {
        icon: makePinIcon({
          access: effectiveAccess(t),
          isUnranked: isUnconfirmed(t),
          isInferred: isInferredPin(t),
          isSelected,
        }),
        zIndexOffset: isSelected ? 1000 : 0,
      });
      marker.on("click", () => onSelect(t.id));
      if (isSelected) selectedMarker = marker;
      else group.addLayer(marker);
    }
    if (selectedMarker) group.addLayer(selectedMarker);
  }, [toilets, selectedId, onSelect]);

  return null;
}
