"use client";

import { create } from "zustand";
import type { Toilet } from "@/types/toilet";

type MapState = {
  toilets: Toilet[];
  setToilets: (t: Toilet[]) => void;
  selectedId: string | null;
  select: (id: string | null) => void;
  userPos: { lat: number; lng: number } | null;
  setUserPos: (p: { lat: number; lng: number } | null) => void;
};

export const useMapStore = create<MapState>((set) => ({
  toilets: [],
  setToilets: (toilets) => set({ toilets }),
  selectedId: null,
  select: (selectedId) => set({ selectedId }),
  userPos: null,
  setUserPos: (userPos) => set({ userPos }),
}));
