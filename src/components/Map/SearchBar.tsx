"use client";

import { useRef, useState } from "react";
import { useMap } from "react-leaflet";
import { useTranslations } from "next-intl";
import { Loader2, Search, X } from "lucide-react";

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
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 入力 onChange で debounce 検索(useEffect ではなくイベントハンドラで実行する)
  const onInputChange = (next: string) => {
    setQ(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!next.trim()) {
      setResults([]);
      setOpen(false);
      setBusy(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setBusy(true);
      try {
        const r = await geocode(next, ac.signal);
        setResults(r);
        setOpen(true);
      } catch {
        // abort や network エラーは無視
      } finally {
        setBusy(false);
      }
    }, 350);
  };

  const select = (r: NominatimResult) => {
    const lat = parseFloat(r.lat);
    const lon = parseFloat(r.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      map.flyTo([lat, lon], 16, { duration: 0.7 });
    }
    setOpen(false);
    setQ(r.name ?? r.display_name.split(",")[0] ?? "");
  };

  return (
    <div className="absolute left-1/2 top-16 z-1000 w-full max-w-md -translate-x-1/2 px-2">
      <div className="relative">
        <div className="flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 shadow-md ring-1 ring-black/5 backdrop-blur dark:bg-zinc-900/95 dark:ring-white/10">
          <Search className="h-4 w-4 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => onInputChange(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
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
              className="rounded-full p-0.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
      </div>
    </div>
  );
}
