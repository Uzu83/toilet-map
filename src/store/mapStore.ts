"use client";

import { create } from "zustand";
import type { Toilet } from "@/types/toilet";

export type Filters = {
  washlet: boolean;
  diaperTable: boolean;
  universal: boolean;
  favoritesOnly: boolean;
};

const DEFAULT_FILTERS: Filters = {
  washlet: false,
  diaperTable: false,
  universal: false,
  favoritesOnly: false,
};

export type View = "map" | "list";

type MapState = {
  toilets: Toilet[];
  setToilets: (t: Toilet[]) => void;
  selectedId: string | null;
  select: (id: string | null) => void;
  userPos: { lat: number; lng: number } | null;
  setUserPos: (p: { lat: number; lng: number } | null) => void;

  // リスト→マップ遷移などで「次にマップが mount したら飛んでね」と伝えるトークン
  flyToTarget: { lat: number; lng: number; zoom?: number } | null;
  setFlyToTarget: (t: { lat: number; lng: number; zoom?: number } | null) => void;

  loading: boolean;
  setLoading: (b: boolean) => void;

  filters: Filters;
  loadFilters: () => void;
  toggleFilter: (key: keyof Filters) => void;
  resetFilters: () => void;

  view: View;
  setView: (v: View) => void;

  favorites: Set<string>;
  loadFavorites: () => void;
  toggleFavorite: (id: string) => void;
};

const FAV_KEY = "toilet-map.favorites";
const FILTERS_KEY = "toilet-map.filters";

function readFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    // ignore
  }
  return new Set();
}

function persistFavorites(s: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...s]));
  } catch {
    // ignore
  }
}

function readFilters(): Filters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<Filters>;
    return {
      washlet: !!parsed.washlet,
      diaperTable: !!parsed.diaperTable,
      universal: !!parsed.universal,
      favoritesOnly: !!parsed.favoritesOnly,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function persistFilters(f: Filters) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    // ignore
  }
}

export const useMapStore = create<MapState>((set, get) => ({
  toilets: [],
  setToilets: (toilets) => set({ toilets }),
  selectedId: null,
  select: (selectedId) => set({ selectedId }),
  userPos: null,
  setUserPos: (userPos) => set({ userPos }),

  flyToTarget: null,
  setFlyToTarget: (flyToTarget) => set({ flyToTarget }),

  loading: false,
  setLoading: (loading) => set({ loading }),

  filters: DEFAULT_FILTERS,
  loadFilters: () => set({ filters: readFilters() }),
  toggleFilter: (key) =>
    set((s) => {
      const next = { ...s.filters, [key]: !s.filters[key] };
      persistFilters(next);
      return { filters: next };
    }),
  resetFilters: () => {
    persistFilters(DEFAULT_FILTERS);
    set({ filters: DEFAULT_FILTERS });
  },

  view: "map",
  setView: (view) => set({ view }),

  favorites: new Set<string>(),
  loadFavorites: () => set({ favorites: readFavorites() }),
  toggleFavorite: (id) => {
    const next = new Set(get().favorites);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistFavorites(next);
    set({ favorites: next });
  },
}));

export function applyFilters(toilets: Toilet[], filters: Filters, favorites: Set<string>): Toilet[] {
  return toilets.filter((t) => {
    if (filters.washlet && !t.has_washlet) return false;
    if (filters.diaperTable && !t.has_diaper_table) return false;
    if (filters.universal && !t.is_universal) return false;
    if (filters.favoritesOnly && !favorites.has(t.id)) return false;
    return true;
  });
}
