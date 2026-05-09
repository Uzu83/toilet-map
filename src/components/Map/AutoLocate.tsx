"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { useMapStore } from "@/store/mapStore";

// 起動 / リロード時に位置情報を取得して、現在地へ flyTo する。
// - DeepLink (?id=) があれば自動移動しない(deep link が優先)
// - 拒否されたら静かにフォールバック(博多駅 or 保存位置)
// - 既に LocateControl で取得済みのセッションでも 2 重起動を避けるためフラグ管理
export function AutoLocate() {
  const map = useMap();
  const setUserPos = useMapStore((s) => s.setUserPos);
  const userPos = useMapStore((s) => s.userPos);
  const triedRef = useRef(false);

  useEffect(() => {
    if (triedRef.current) return;
    if (typeof window === "undefined") return;

    // deep link がある場合はそちらを優先(AutoLocate は走らない)
    const hasDeepLink = new URL(window.location.href).searchParams.has("id");
    if (hasDeepLink) {
      triedRef.current = true;
      return;
    }

    if (!("geolocation" in navigator)) {
      triedRef.current = true;
      return;
    }

    triedRef.current = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserPos({ lat: latitude, lng: longitude });
        // smooth に飛ぶ。ズーム 16 = 街レベル
        map.flyTo([latitude, longitude], 16, { duration: 0.6 });
      },
      // 拒否・エラーは無視(初期位置のまま)
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
    );
  }, [map, setUserPos]);

  // userPos は副作用なし(他箇所での表示用)
  void userPos;
  return null;
}
