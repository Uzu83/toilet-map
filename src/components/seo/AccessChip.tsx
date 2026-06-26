import { ACCESS_BADGE_COLORS, type AccessLevel } from "@/types/toilet";

// 利用区分の色付きチップ。label は呼び出し側で i18n から解決して渡す。
// size="sm" は一覧用の小型。
// WHY (白文字 on 濃色 = ACCESS_BADGE_COLORS / dark mode 不要):
//   旧実装は「色文字 on 12%tint + border」で WCAG 1.9–3.6:1 と AA 不足だった。
//   PinSheet のアクセスバッジと同じ「white 文字 on ACCESS_BADGE_COLORS(濃色)」に統一し、
//   AA(open 5.17 / ask 5.02 / permission 6.47:1)を満たす。Google 流入の着地点(/toilet・/area)で
//   「一声かけて/許可が必要」の安全情報が読めることが重要。
//   濃色 bg + 白文字はライト/ダーク両方でコントラストが成立するため dark: バリアントは不要
//   (地図ピン用 ACCESS_COLORS は使わない — それだと白文字でコントラスト不足が再発する)。
export function AccessChip({
  level,
  label,
  size = "md",
}: {
  level: AccessLevel | null;
  label: string;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";
  if (!level) {
    return (
      <span className={`inline-flex items-center rounded-full bg-zinc-200 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 ${pad}`}>
        {label}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium text-white ${pad}`}
      style={{ backgroundColor: ACCESS_BADGE_COLORS[level] }}
    >
      {label}
    </span>
  );
}
