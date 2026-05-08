import L from "leaflet";
import { ACCESS_LEVELS, type AccessLevel } from "@/types/toilet";

const STAR = `<path d="M10 1.5l2.62 5.31 5.86.85-4.24 4.13 1 5.84L10 14.88 4.76 17.63l1-5.84L1.52 7.66l5.86-.85L10 1.5z" fill="#fff" stroke="rgba(0,0,0,.25)" stroke-width=".5"/>`;

export function makePinIcon(opts: {
  access: AccessLevel | null;
  isUnranked: boolean;
  isInferred?: boolean;
}): L.DivIcon {
  const color = opts.access ? ACCESS_LEVELS[opts.access].color : "#9CA3AF";
  const strokeColor = opts.isInferred
    ? color // 推定ピンは輪郭も色味、実線ではなく破線で「未確認」を示唆
    : opts.isUnranked
    ? "#E5E7EB"
    : "#1F2937";
  const strokeWidth = opts.isInferred ? 2 : opts.isUnranked ? 1.5 : 2;
  const dash = opts.isInferred ? `stroke-dasharray="3 2"` : "";
  const opacity = opts.isInferred ? 0.65 : opts.isUnranked ? 0.75 : 1;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46" style="filter: drop-shadow(0 2px 3px rgba(0,0,0,.35));">
  <path d="M18 1c-9.4 0-17 7.4-17 16.5 0 12 17 27.5 17 27.5s17-15.5 17-27.5C35 8.4 27.4 1 18 1z"
        fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${dash} opacity="${opacity}"/>
  <g transform="translate(8 8)">${STAR}</g>
</svg>`;

  return L.divIcon({
    html: svg,
    className: "toilet-pin",
    iconSize: [36, 46],
    iconAnchor: [18, 44],
    popupAnchor: [0, -38],
  });
}
