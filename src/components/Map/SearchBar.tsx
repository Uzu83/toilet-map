"use client";

import { useRef, useState } from "react";
import { useMap } from "react-leaflet";
import { useTranslations } from "next-intl";
import { Loader2, Search, X } from "lucide-react";
import { parseNominatimSearchOrigin } from "@/lib/listOrigin";
import { shouldConfirmFirstSuggestion } from "@/lib/searchConfirm";
import { useMapStore } from "@/store/mapStore";

type NominatimResult = {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
};

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

async function geocode(q: string, signal: AbortSignal): Promise<NominatimResult[]> {
  if (!q.trim()) return [];
  const params = new URLSearchParams({
    q,
    format: "json",
    addressdetails: "0",
    limit: "5",
    countrycodes: "jp",
    "accept-language": "ja",
  });
  const res = await fetch(`${NOMINATIM}?${params}`, { signal, cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()) as NominatimResult[];
}

export function SearchBar() {
  const t = useTranslations("search");
  const map = useMap();
  const setSearchOrigin = useMapStore((s) => s.setSearchOrigin);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [resultsQuery, setResultsQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 入力 onChange で debounce 検索(useEffect ではなくイベントハンドラで実行する)
  const onInputChange = (next: string) => {
    setQ(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    // debounce 待ち中に旧 fetch が完了すると旧候補が復活する（GPT F001）
    abortRef.current?.abort();
    abortRef.current = null;
    setResults([]);
    setResultsQuery("");
    setOpen(false);
    if (!next.trim()) {
      setBusy(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      const ac = new AbortController();
      abortRef.current = ac;
      setBusy(true);
      try {
        const r = await geocode(next, ac.signal);
        if (ac.signal.aborted) return;
        setResults(r);
        setResultsQuery(next.trim());
        setOpen(true);
      } catch {
        if (ac.signal.aborted) return;
        setResults([]);
        setResultsQuery(next.trim());
        setOpen(true);
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    }, 350);
  };

  const select = (r: NominatimResult) => {
    const origin = parseNominatimSearchOrigin(r);
    // 開いていたピン詳細を閉じ、?id= を外す。距離原点は検索地点に自動切替しない(#33)。
    useMapStore.getState().select(null);
    if (origin) {
      map.flyTo([origin.lat, origin.lng], 16, { duration: 0.7 });
      setSearchOrigin(origin);
    }
    setOpen(false);
    setQ(r.name ?? r.display_name.split(",")[0] ?? "");
  };

  const onEnter = (isComposing: boolean) => {
    if (
      shouldConfirmFirstSuggestion({
        isComposing,
        open,
        resultCount: results.length,
        resultsQuery,
        currentQuery: q,
      })
    ) {
      const first = results[0];
      if (first) select(first);
      return;
    }
    if (isComposing) return;
    if (!q.trim()) return;
    // 0 件 / 失敗後の Enter は地図を動かさず「場所を見つけられませんでした」を出す。
    setOpen(true);
  };

  const showNoResults = open && results.length === 0 && q.trim().length > 0 && !busy;

  return (
    <div className="absolute left-1/2 top-16 z-1000 w-full max-w-md -translate-x-1/2 px-2">
      <div className="relative">
        {/*
          WHY (min-h-11 の理由):
            旧実装 py-1.5 = 上下 6px × 2 + input 行高(20px) = 32px → 44px 目安を下回る。
            min-h-11(44px) を付けることでタップ領域を確保しつつ、
            px-3 の横パディングと rounded-full の見た目は変えない。
          WHY (クリアボタンの min-h-11 min-w-11):
            p-0.5 だとクリア × が 24px 程度。44px に拡大して誤タップを防ぐ。
        */}
        <div className="flex min-h-11 items-center gap-2 rounded-full bg-white/95 px-3 shadow-md ring-1 ring-black/5 backdrop-blur dark:bg-zinc-900/95 dark:ring-white/10">
          <Search className="h-4 w-4 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => onInputChange(e.target.value)}
            onFocus={() => (results.length > 0 || showNoResults) && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const composing = e.nativeEvent.isComposing || e.keyCode === 229;
              if (composing) return;
              e.preventDefault();
              onEnter(false);
            }}
            placeholder={t("placeholder")}
            className="flex-1 bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
          {busy && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
          {q && !busy && (
            <button
              type="button"
              onClick={() => {
                onInputChange("");
              }}
              aria-label={t("clear")}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {open && results.length > 0 && (
          <ul className="absolute inset-x-0 top-12 max-h-64 overflow-y-auto rounded-xl bg-white shadow-xl ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
            {results.map((r) => (
              <li key={r.place_id}>
                <button
                  type="button"
                  onClick={() => select(r)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 dark:hover:bg-zinc-800"
                >
                  <span className="block font-semibold text-zinc-900 dark:text-zinc-50">
                    {r.name ?? r.display_name.split(",")[0]}
                  </span>
                  <span className="line-clamp-1 text-[11px] text-zinc-500">
                    {r.display_name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {showNoResults && (
          <div
            role="status"
            className="absolute inset-x-0 top-12 rounded-xl bg-white px-3 py-3 shadow-xl ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10"
          >
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {t("noResults")}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500">{t("noResultsHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
