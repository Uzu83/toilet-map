"use client";

import { useState } from "react";
import { useMap } from "react-leaflet";
import { Crosshair, Loader2 } from "lucide-react";
import { useMapStore } from "@/store/mapStore";

export function LocateControl() {
  const map = useMap();
  const setUserPos = useMapStore((s) => s.setUserPos);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setDenied(true);
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserPos({ lat: latitude, lng: longitude });
        map.flyTo([latitude, longitude], 16, { duration: 0.6 });
        setBusy(false);
      },
      () => {
        setDenied(true);
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <button
      type="button"
      onClick={locate}
      aria-label="現在地に移動"
      title={denied ? "位置情報の許可がありません" : "現在地に移動"}
      className="absolute right-3 bottom-32 z-1000 flex h-12 w-12 items-center justify-center rounded-full bg-white text-blue-600 shadow-lg ring-1 ring-black/10 hover:bg-blue-50 active:scale-95"
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Crosshair className="h-5 w-5" />}
    </button>
  );
}
