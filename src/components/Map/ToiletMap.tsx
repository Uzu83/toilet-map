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

import { useMapStore } from "@/store/mapStore";
import { makePinIcon } from "./pinIcon";
import { effectiveAccess, isUnconfirmed } from "@/types/toilet";
import { LocateControl } from "./LocateControl";
import { CompassBadge } from "./CompassBadge";
import { PinSheet } from "./PinSheet";
import type { Toilet } from "@/types/toilet";

// 博多駅(福岡市シード対象に合わせたフォールバック)
const HAKATA_STATION: [number, number] = [33.5904, 130.4204];

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
    moveend: () => onChange(map.getBounds()),
    zoomend: () => onChange(map.getBounds()),
  });
  return null;
}

async function fetchToilets(bounds: L.LatLngBounds): Promise<Toilet[]> {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const bbox = `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
  const res = await fetch(`/api/toilets?bbox=${bbox}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { toilets?: Toilet[] };
  return json.toilets ?? [];
}

export default function ToiletMap() {
  const setToilets = useMapStore((s) => s.setToilets);
  const select = useMapStore((s) => s.select);
  const toilets = useMapStore((s) => s.toilets);
  const userPos = useMapStore((s) => s.userPos);
  const [error, setError] = useState<string | null>(null);

  const initialCenter: [number, number] = useMemo(() => HAKATA_STATION, []);

  const refetch = useRef(
    debounce(async (bounds: L.LatLngBounds) => {
      try {
        const t = await fetchToilets(bounds);
        setToilets(t);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "fetch failed");
      }
    }, 500)
  ).current;

  const onBoundsChange = useCallback(
    (b: L.LatLngBounds) => {
      void refetch(b);
    },
    [refetch]
  );

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={initialCenter}
        zoom={15}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <BoundsWatcher onChange={onBoundsChange} />
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
        {toilets.map((t) => (
          <Marker
            key={t.id}
            position={[t.lat, t.lng]}
            icon={makePinIcon({
              access: effectiveAccess(t),
              isUnranked: isUnconfirmed(t),
              isInferred: t.source === "inferred" && t.review_count === 0,
            })}
            eventHandlers={{ click: () => select(t.id) }}
          />
        ))}
      </MapContainer>
      <CompassBadge />
      <PinSheet />
      {error && (
        <div className="absolute left-4 top-4 z-1000 rounded-lg bg-red-500/90 px-3 py-2 text-sm text-white shadow">
          読み込みエラー: {error}
        </div>
      )}
    </div>
  );
}
