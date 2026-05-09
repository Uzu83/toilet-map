"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { applyFilters, useMapStore } from "@/store/mapStore";
import { LocateControl } from "./LocateControl";
import { CompassBadge } from "./CompassBadge";
import { PinSheet } from "./PinSheet";
import { FilterBar } from "./FilterBar";
import { PinLegend } from "./PinLegend";
import { EmptyState } from "./EmptyState";
import { LoadingIndicator } from "./LoadingIndicator";
import { ClusteredMarkers } from "./ClusteredMarkers";
import { SearchBar } from "./SearchBar";
import { DeepLinkResolver } from "./DeepLinkResolver";
import { AutoLocate } from "./AutoLocate";
import { FlyToWatcher } from "./FlyToWatcher";
import type { Toilet } from "@/types/toilet";

// 博多駅(福岡市シード対象に合わせたフォールバック)
const HAKATA_STATION: [number, number] = [33.5904, 130.4204];
const VIEW_KEY = "toilet-map.view";

type SavedView = { lat: number; lng: number; zoom: number };

function readSavedView(): SavedView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedView;
    if (
      typeof v.lat === "number" &&
      typeof v.lng === "number" &&
      typeof v.zoom === "number"
    ) {
      return v;
    }
  } catch {
    // ignore
  }
  return null;
}

function persistView(v: SavedView) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let h: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (h) clearTimeout(h);
    h = setTimeout(() => fn(...args), ms);
  };
}

function BoundsWatcher({ onChange }: { onChange: (b: L.LatLngBounds) => void }) {
  const map = useMap();
  useEffect(() => {
    onChange(map.getBounds());
  }, [map, onChange]);
  useMapEvents({
    moveend: () => {
      onChange(map.getBounds());
      const c = map.getCenter();
      persistView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    },
    zoomend: () => {
      onChange(map.getBounds());
      const c = map.getCenter();
      persistView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    },
  });
  return null;
}

async function fetchToilets(bounds: L.LatLngBounds): Promise<Toilet[]> {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const bbox = `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
  const url = `/api/toilets?bbox=${bbox}`;
  // 一時的なサーバエラーは 1 回だけリトライ(指数バックオフ最小)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        if (res.status >= 500 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        throw new Error(`API ${res.status}`);
      }
      const json = (await res.json()) as { toilets?: Toilet[] };
      return json.toilets ?? [];
    } catch (e) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      throw e;
    }
  }
  return [];
}

export default function ToiletMap() {
  const setToilets = useMapStore((s) => s.setToilets);
  const select = useMapStore((s) => s.select);
  const toilets = useMapStore((s) => s.toilets);
  const userPos = useMapStore((s) => s.userPos);
  const filters = useMapStore((s) => s.filters);
  const favorites = useMapStore((s) => s.favorites);
  const setLoading = useMapStore((s) => s.setLoading);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  const initial = useMemo(() => {
    const saved = readSavedView();
    if (saved) return { center: [saved.lat, saved.lng] as [number, number], zoom: saved.zoom };
    return { center: HAKATA_STATION, zoom: 15 };
  }, []);

  const refetch = useRef(
    debounce(async (bounds: L.LatLngBounds) => {
      setLoading(true);
      try {
        const t = await fetchToilets(bounds);
        setToilets(t);
        setHasFetched(true);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "fetch failed");
      } finally {
        setLoading(false);
      }
    }, 500)
  ).current;

  const onBoundsChange = useCallback(
    (b: L.LatLngBounds) => {
      void refetch(b);
    },
    [refetch]
  );

  const visible = useMemo(
    () => applyFilters(toilets, filters, favorites),
    [toilets, filters, favorites]
  );
  const filterActive = useMemo(() => Object.values(filters).some(Boolean), [filters]);
  const showEmpty = hasFetched && visible.length === 0 && !error;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={initial.center}
        zoom={initial.zoom}
        scrollWheelZoom
        zoomControl={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <BoundsWatcher onChange={onBoundsChange} />
        <DeepLinkResolver />
        <AutoLocate />
        <FlyToWatcher />
        <SearchBar />
        <LocateControl />
        {userPos && (
          <Marker
            position={[userPos.lat, userPos.lng]}
            icon={L.divIcon({
              className: "user-pos",
              iconSize: [20, 20],
              html: `<div style="width:20px;height:20px;border-radius:50%;background:#2563EB;border:3px solid white;box-shadow:0 0 0 2px rgba(37,99,235,.4);"></div>`,
            })}
            interactive={false}
          />
        )}
        <ClusteredMarkers toilets={visible} onSelect={select} />
      </MapContainer>
      <FilterBar visibleCount={visible.length} />
      <CompassBadge />
      <LoadingIndicator />
      <PinLegend />
      {showEmpty && <EmptyState filtered={filterActive} />}
      <PinSheet />
      {error && (
        <div className="absolute left-4 top-20 z-1000 rounded-lg bg-red-500/90 px-3 py-2 text-sm text-white shadow">
          読み込みエラー: {error}
        </div>
      )}
    </div>
  );
}
