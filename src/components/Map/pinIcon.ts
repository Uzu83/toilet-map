import L from "leaflet";
import { ACCESS_COLORS, type AccessLevel } from "@/types/toilet";

const STAR = `<path d="M10 1.5l2.62 5.31 5.86.85-4.24 4.13 1 5.84L10 14.88 4.76 17.63l1-5.84L1.52 7.66l5.86-.85L10 1.5z" fill="#fff" stroke="rgba(0,0,0,.25)" stroke-width=".5"/>`;

// 選択ピンの無限パルス(SMIL <animate>)を出すかどうか。
// WHY (matchMedia を call 時に毎回読む / module スコープでキャッシュしない):
//   prefers-reduced-motion はユーザーが OS 設定中に切り替えうる。ピンは選択のたびに
//   makePinIcon で作り直されるので、call 時評価なら設定変更が次の選択から反映される。
// WHY (typeof window ガード): pinIcon は client 専用(ClusteredMarkers は "use client")だが、
//   万一 SSR 経路から import されても hydration mismatch / ReferenceError を起こさないよう、
//   window 不在時は「動かさない(=パルス無し)」安全側に倒す。SSR でピンは描画されないので実害なし。
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// HTML 特殊文字を SVG <title> 等に安全に埋め込むためのエスケープ。
// WHY: トイレ名は OSM 由来でユーザー生成に近く、& や < > " を含みうる。divIcon の html は
//   文字列連結で SVG を組むため、未エスケープだと SVG/HTML が壊れる(最悪 XSS)。label は
//   ここで必ずエスケープしてから <title> に入れる。
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function makePinIcon(opts: {
  access: AccessLevel | null;
  isUnranked: boolean;
  isInferred?: boolean;
  isSelected?: boolean;
  // SR 用のアクセシブル名(例「博多駅公衆トイレ、声かけ不要、★4.2」)。
  // SVG に role="img" + <title> として埋め込む。marker.options.alt/title 側でも別途付与する。
  label?: string;
}): L.DivIcon {
  const color = opts.access ? ACCESS_COLORS[opts.access] : "#9CA3AF";
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

  // 選択ピンの外周リング。
  // 通常はパルス(SMIL <animate> の無限ループ)で「選択中」を強調するが、
  // prefers-reduced-motion: reduce のユーザーには <animate> を出さず静的リングのみにする
  // (CSS media query は SMIL を止められないため、ここで出力自体を分岐する。冒頭 WHY 参照)。
  // 静的リングは残すことで、モーション無しでも「どのピンが選択中か」は視覚的に判別できる。
  const ring = opts.isSelected
    ? prefersReducedMotion()
      ? `<circle cx="18" cy="17.5" r="16" fill="none" stroke="${color}" stroke-width="2" opacity="0.45"/>`
      : `<circle cx="18" cy="17.5" r="14" fill="none" stroke="${color}" stroke-width="2" opacity="0.45">
         <animate attributeName="r" values="14;19;14" dur="1.6s" repeatCount="indefinite"/>
         <animate attributeName="opacity" values="0.45;0;0.45" dur="1.6s" repeatCount="indefinite"/>
       </circle>`
    : "";

  const dropShadow = opts.isSelected
    ? "filter: drop-shadow(0 4px 6px rgba(0,0,0,.5));"
    : "filter: drop-shadow(0 2px 3px rgba(0,0,0,.35));";

  // SVG の SR 名。label があれば role="img" + aria-label + <title> で名前を与える
  // (focusable な Leaflet コンテナ=role="button" の accessible name は子要素=この SVG から計算され、
  //  title 属性より子の名前が優先されるので、ここの aria-label が実質のマーカー名になる)。
  // label が無い(=ClusteredMarkers 以外の想定外呼び出し)場合は装飾として aria-hidden で隠す。
  const a11y = opts.label
    ? `role="img" aria-label="${escapeXml(opts.label)}"`
    : `aria-hidden="true"`;
  const titleEl = opts.label ? `<title>${escapeXml(opts.label)}</title>` : "";

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 36 46" style="${dropShadow}" ${a11y}>
  ${titleEl}
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

// pending(ユーザー申請・未承認)ピン。
// inferred(破線 + access 色 + 半透明 + 星)とは別の視覚語彙にする:
//   - 色: indigo(#6366F1) — access 色(青/黄/赤)とも inferred ともグレーとも違う固有色
//   - ストローク: 点線(dotted "1 3")— inferred の破線("3 2")と区別
//   - グリフ: 星ではなく「+」(=これから追加される提案)
//   - confirm_count バッジ(右上の小円)で追認の進捗を示す
export function makePendingPinIcon(opts: { confirmCount?: number }): L.DivIcon {
  const color = "#6366F1";
  const w = 32;
  const h = 42;
  const count = opts.confirmCount ?? 0;

  const badge =
    count > 0
      ? `<g transform="translate(24 6)">
           <circle cx="0" cy="0" r="7" fill="#fff" stroke="${color}" stroke-width="1.5"/>
           <text x="0" y="3.5" text-anchor="middle" font-size="9" font-weight="700" fill="${color}">${count > 9 ? "9+" : count}</text>
         </g>`
      : "";

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 36 46" style="filter: drop-shadow(0 2px 3px rgba(0,0,0,.3));">
  <path d="M18 1c-9.4 0-17 7.4-17 16.5 0 12 17 27.5 17 27.5s17-15.5 17-27.5C35 8.4 27.4 1 18 1z"
        fill="${color}" fill-opacity="0.55" stroke="${color}" stroke-width="2" stroke-dasharray="1 3"/>
  <path d="M18 10.5 v13 M11.5 17 h13" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>
  ${badge}
</svg>`;

  return L.divIcon({
    html: svg,
    className: "toilet-pin toilet-pin-pending",
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), h - 2],
    popupAnchor: [0, -h + 8],
  });
}
