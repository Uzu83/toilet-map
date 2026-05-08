"use client";

import { Compass } from "lucide-react";

export function CompassBadge() {
  return (
    <div
      aria-label="北方位"
      className="absolute right-3 top-3 z-1000 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-zinc-700 shadow ring-1 ring-black/10"
    >
      <Compass className="h-5 w-5" />
      <span className="sr-only">北</span>
    </div>
  );
}
