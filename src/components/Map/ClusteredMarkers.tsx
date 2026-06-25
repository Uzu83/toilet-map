"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

import {
  type AccessLevel,
  effectiveAccess,
  isInferredPin,
  isUnconfirmed,
  type Toilet,
} from "@/types/toilet";
import { makePinIcon } from "./pinIcon";

type Props = {
  toilets: Toilet[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function ClusteredMarkers({ toilets, selectedId, onSelect }: Props) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);
  // SR 用ラベルの翻訳。a11y = marker/cluster 名、access = アクセスレベルのラベル、
  // pinSheet = 無名トイレのフォールバック名(unnamed)。
  const ta11y = useTranslations("a11y");
  const taccess = useTranslations("access");
  const tpin = useTranslations("pinSheet");

  // 1 つのトイレの SR 用アクセシブル名を組み立てる(例「博多駅公衆トイレ、声かけ不要、★4.2」)。
  // WHY (name 空のとき pinSheet.unnamed を使う): OSM 由来で名称欠落のピンは多い。aria-label を
  //   空文字にすると SR がボタンを無名で読み上げてしまうため、「名称未設定のトイレ」相当の
  //   既訳(pinSheet.unnamed = "toilet" の語を含む)を name のフォールバックに使う。
  const markerLabel = (t: Toilet): string => {
    const access: AccessLevel | null = effectiveAccess(t);
    const accessLabel = access ? taccess(`${access}.label`) : null;
    const name = t.name ?? tpin("unnamed");
    const hasRating = t.review_count > 0 && t.avg_rating != null;
    if (accessLabel && hasRating) {
      return ta11y("marker", {
        name,
        access: accessLabel,
        rating: (t.avg_rating ?? 0).toFixed(1),
      });
    }
    if (accessLabel) {
      return ta11y("markerNoRating", { name, access: accessLabel });
    }
    return ta11y("markerNoAccess", { name });
  };

  // クラスタの件数ラベルを ref 経由で iconCreateFunction に渡す。
  // WHY (ref にする / 直接 group 生成 effect の deps に入れない): クラスタグループ生成 effect は
  //   deps=[map] で 1 度だけ走らせたい(再生成すると全マーカーが作り直され表示がちらつく)。
  //   翻訳関数 ta11y は毎レンダー identity が変わりうるので、それを group 生成 deps に入れると
  //   group が無駄に再生成される。ref に最新の翻訳関数を載せ(下の effect で更新)、
  //   iconCreateFunction は ref を読むことで group を再生成せず最新ロケールでラベルを出す。
  // WHY (ref 更新を render 中でなく effect でやる): render 中の ref 書き換えは React の
  //   "Cannot update ref during render"(react-hooks/refs)に触れる。副作用は effect に置く。
  const clusterLabelRef = useRef<(count: number) => string>((count) => String(count));
  useEffect(() => {
    clusterLabelRef.current = (count: number) => ta11y("cluster", { count });
  }, [ta11y]);

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
        // クラスタ円に SR 用の件数ラベルを付ける(role="img" + aria-label)。
        // 内側の数字は装飾なので aria-hidden(aria-label と二重読みされないように)。
        const label = clusterLabelRef.current(count).replace(/"/g, "&quot;");
        return L.divIcon({
          html: `
<div role="img" aria-label="${label}" style="
  width:${size}px;height:${size}px;border-radius:50%;
  background:rgba(59,130,246,.85);color:#fff;
  display:flex;align-items:center;justify-content:center;
  font-weight:700;font-size:${count < 100 ? 13 : 11}px;
  box-shadow:0 2px 6px rgba(0,0,0,.3);
  border:2px solid rgba(255,255,255,.9);
"><span aria-hidden="true">${count}</span></div>`,
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
      const label = markerLabel(t);
      const marker = L.marker([t.lat, t.lng], {
        icon: makePinIcon({
          access: effectiveAccess(t),
          isUnranked: isUnconfirmed(t),
          isInferred: isInferredPin(t),
          isSelected,
          label,
        }),
        zIndexOffset: isSelected ? 1000 : 0,
        // a11y: Leaflet は title が truthy のとき icon 要素に title/alt を付け、
        // keyboard:true で role="button" + tabindex=0 にしてキーボード到達可にする(Leaflet 1.9.4)。
        // title = アクセシブル名 + ネイティブツールチップを兼ねる。
        keyboard: true,
        title: label,
        alt: label,
      });
      marker.on("click", () => onSelect(t.id));
      if (isSelected) selectedMarker = marker;
      else group.addLayer(marker);
    }
    if (selectedMarker) group.addLayer(selectedMarker);
    // markerLabel は ta11y/taccess に依存して毎レンダー再生成される。
    // ロケール切替時にラベルを作り直したいので翻訳関数を deps に含める。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toilets, selectedId, onSelect, ta11y, taccess]);

  return null;
}
