"use client";

import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import { useTranslations } from "next-intl";
import { Crosshair, Loader2 } from "lucide-react";
import { useMapStore } from "@/store/mapStore";

const LOCATE_TIMEOUT_MS = 8000;

export function LocateControl() {
  const t = useTranslations("map");
  const map = useMap();
  const setUserPos = useMapStore((s) => s.setUserPos);
  const setNotice = useMapStore((s) => s.setNotice);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const settledRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const finish = (onDone?: () => void) => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setBusy(false);
    onDone?.();
  };

  const fail = () => {
    finish(() => {
      setDenied(true);
      setNotice({ kind: "locateDenied" });
    });
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setDenied(true);
      setNotice({ kind: "locateDenied" });
      return;
    }
    if (!settledRef.current) return;
    settledRef.current = false;
    setBusy(true);
    timerRef.current = setTimeout(fail, LOCATE_TIMEOUT_MS);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          finish(() => {
            setDenied(false);
            setNotice(null);
            setUserPos({ lat: latitude, lng: longitude });
            map.flyTo([latitude, longitude], 16, { duration: 0.6 });
          });
        },
        fail,
        { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS },
      );
    } catch {
      fail();
    }
  };

  return (
    <button
      type="button"
      onClick={locate}
      aria-label={t("locate")}
      title={denied ? t("locateDenied") : t("locate")}
      className="absolute right-3 bottom-32 z-1000 flex h-12 w-12 items-center justify-center rounded-full bg-white text-blue-600 shadow-lg ring-1 ring-black/10 hover:bg-blue-50 active:scale-95"
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Crosshair className="h-5 w-5" />}
    </button>
  );
}
