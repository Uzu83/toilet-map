import L from "leaflet";
import { ACCESS_LEVELS, type AccessLevel } from "@/types/toilet";

const STAR = `<path d="M10 1.5l2.62 5.31 5.86.85-4.24 4.13 1 5.84L10 14.88 4.76 17.63l1-5.84L1.52 7.66l5.86-.85L10 1.5z" fill="#fff" stroke="rgba(0,0,0,.25)" stroke-width=".5"/>`;

export function makePinIcon(opts: {
  access: AccessLevel | null;
  isUnranked: boolean;
  isInferred?: boolean;
  isSelected?: boolean;
}): L.DivIcon {
  const color = opts.access ? ACCESS_LEVELS[opts.access].color : "#9CA3AF";
  const strokeColor = opts.isSelected
    ? "#FFFFFF"
    : opts.isInferred
    ? color // 推定ピンは輪郭も色味、実線ではなく破線で「未確認」を示唆
    : opts.isUnranked
    ? "#E5E7EB"
    : "#1F2937";
  const strokeWidth = opts.isSelected ? 3 : opts.isInferred ? 2 : opts.isUnranked ? 1.5 : 2;
  const dash = opts.isInferred && !opts.isSelected ? `stroke-dasharray="3 2"` : "";
  const opacity = opts.isSelected ? 1 : opts.isInferred ? 0.65 : opts.isUnranked ? 0.75 : 1;

  // 選択中は 1.4倍のサイズ + パルス的な外周リング
  const scale = opts.isSelected ? 1.4 : 1;
  const w = Math.round(36 * scale);
  const h = Math.round(46 * scale);

  const ring = opts.isSelected
    ? `<circle cx="18" cy="17.5" r="14" fill="none" stroke="${color}" stroke-width="2" opacity="0.45">
         <animate attributeName="r" values="14;19;14" dur="1.6s" repeatCount="indefinite"/>
         <animate attributeName="opacity" values="0.45;0;0.45" dur="1.6s" repeatCount="indefinite"/>
       </circle>`
    : "";

  const dropShadow = opts.isSelected
    ? "filter: drop-shadow(0 4px 6px rgba(0,0,0,.5));"
    : "filter: drop-shadow(0 2px 3px rgba(0,0,0,.35));";

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 36 46" style="${dropShadow}">
  ${ring}
  <path d="M18 1c-9.4 0-17 7.4-17 16.5 0 12 17 27.5 17 27.5s17-15.5 17-27.5C35 8.4 27.4 1 18 1z"
        fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${dash} opacity="${opacity}"/>
  <g transform="translate(8 8)">${STAR}</g>
</svg>`;

  return L.divIcon({
    html: svg,
    className: opts.isSelected ? "toilet-pin toilet-pin-selected" : "toilet-pin",
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), h - 2],
    popupAnchor: [0, -h + 8],
  });
}
