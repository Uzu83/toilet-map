"use client";

import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { useTransition } from "react";
import { Globe } from "lucide-react";
import { routing } from "@/i18n/routing";
import { usePathname, useRouter } from "@/i18n/navigation";

const LABELS: Record<string, string> = {
  ja: "日本語",
  en: "English",
  ko: "한국어",
  zh: "中文",
};

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [isPending, startTransition] = useTransition();

  const onChange = (next: string) => {
    startTransition(() => {
      // 現在のパスを保ったまま locale だけ差し替える
      router.replace(
        // @ts-expect-error -- pathnames は文字列で OK(動的セグメントなしのため)
        { pathname, params },
        { locale: next }
      );
    });
  };

  return (
    <label className="relative inline-flex items-center">
      <Globe className="pointer-events-none absolute left-1.5 h-3.5 w-3.5 text-zinc-400" />
      <select
        aria-label="Language"
        value={locale}
        disabled={isPending}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md bg-transparent py-1 pl-6 pr-1 text-xs text-zinc-600 outline-none hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {LABELS[l] ?? l}
          </option>
        ))}
      </select>
    </label>
  );
}
