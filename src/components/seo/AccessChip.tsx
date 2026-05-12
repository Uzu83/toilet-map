import { ACCESS_COLORS, type AccessLevel } from "@/types/toilet";

// 利用区分の色付きチップ。色は型側(ACCESS_COLORS)を真実とする。
// label は呼び出し側で i18n から解決して渡す。size="sm" は一覧用の小型。
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
  const color = ACCESS_COLORS[level];
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${pad}`}
      style={{ backgroundColor: `${color}1f`, color, border: `1px solid ${color}66` }}
    >
      {label}
    </span>
  );
}
