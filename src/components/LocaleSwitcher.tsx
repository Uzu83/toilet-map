"use client";

import { useLocale, useTranslations } from "next-intl";
import { routing } from "@/i18n/routing";
import { Link, usePathname } from "@/i18n/navigation";

// プルダウンだと「どう操作するか」が一目で分からない人がいるので、
// 4 言語を常に横並びで表示し、現在の言語をハイライトしてそのままタップで切り替え。
const LABELS: Record<string, string> = {
  ja: "日本語",
  en: "English",
  ko: "한국어",
  zh: "中文",
};

export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("a11y");

  return (
    /*
      WHY (inline-flex min-h-11 items-center の理由):
        旧実装はテキストリンク(text-xs)のみで実寸 16px 前後。
        言語切り替えは誤タップされやすい小さなリンクが隣接しているため、44px 目安が特に重要。
        各言語リンクに inline-flex min-h-11 items-center px-1 を付けてタップ領域を拡大する。
        現在言語の <span> も同サイズにして視覚と当たり判定を揃える。
        区切り「·」は aria-hidden の装飾要素で当たり判定不要なので小さいままにする。
    */
    <nav aria-label={t("language")} className="flex items-center text-xs">
      {routing.locales.map((l, i) => (
        <span key={l} className="flex items-center">
          {i > 0 && (
            <span aria-hidden className="text-zinc-300 dark:text-zinc-700">
              ·
            </span>
          )}
          {l === locale ? (
            <span aria-current="true" className="inline-flex min-h-11 items-center px-1 font-semibold text-blue-600">
              {LABELS[l] ?? l}
            </span>
          ) : (
            <Link
              href={pathname}
              locale={l}
              className="inline-flex min-h-11 items-center px-1 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {LABELS[l] ?? l}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
