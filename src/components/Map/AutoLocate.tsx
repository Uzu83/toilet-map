"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { shouldFlyToGps } from "@/lib/listOrigin";
import { parseMapViewQuery } from "@/lib/mapViewQuery";
import { useMapStore } from "@/store/mapStore";

const ONBOARDING_STORAGE_KEY = "toilet-map.onboarding.dismissed";
const ONBOARDING_DISMISSED_EVENT = "loo-onboarding-dismissed";

// 起動 / リロード時に位置情報を取得して、現在地へ flyTo する。
// - DeepLink (?id=) またはエリア地図クエリ (?lat=&lng=) があれば自動移動しない
// - オンボーディング未閉じなら GPS しない(二重ダイアログ回避)。閉じたら 1 回取る
// - 拒否されたら静かにフォールバック(博多駅 or 保存位置)
// - 既に LocateControl で取得済みのセッションでも 2 重起動を避けるためフラグ管理
export function AutoLocate() {
  const map = useMap();
  const setUserPos = useMapStore((s) => s.setUserPos);
  const triedRef = useRef(false);

  useEffect(() => {
    if (triedRef.current) return;
    if (typeof window === "undefined") return;

    const params = new URL(window.location.href).searchParams;
    // deep link / エリア中心リンクがある場合はそちらを優先(AutoLocate は走らない)
    if (params.has("id") || parseMapViewQuery(params)) {
      triedRef.current = true;
      return;
    }

    const locate = () => {
      if (triedRef.current) return;
      if (!("geolocation" in navigator)) {
        triedRef.current = true;
        return;
      }
      triedRef.current = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setUserPos({ lat: latitude, lng: longitude });
          const { searchOrigin } = useMapStore.getState();
          if (shouldFlyToGps(searchOrigin)) {
            map.flyTo([latitude, longitude], 16, { duration: 0.6 });
          }
        },
        () => {},
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
      );
    };

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
    } catch {
      dismissed = false;
    }

    if (dismissed) {
      locate();
      return;
    }

    const onDismissed = () => {
      locate();
    };
    window.addEventListener(ONBOARDING_DISMISSED_EVENT, onDismissed, { once: true });
    return () => window.removeEventListener(ONBOARDING_DISMISSED_EVENT, onDismissed);
    // WHY userPos ストアセレクターを購読しないか:
    //   triedRef.current = true が既に「1 回だけ実行する」ガードを担っている。
    //   userPos を deps に含めると「GPS 取得成功 → setUserPos → AutoLocate 再レンダー」の
    //   ループが起きうる上、triedRef で弾かれるだけなので実害はないが無駄なサブスクリプションが残る。
  }, [map, setUserPos]);

  return null;
}
