import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export type Crumb = { label: string; href?: string };

// 可視パンくず(JSON-LD は別コンポーネント)。href があればロケール付きリンク。
// useTranslations は同期 Server Component(= shared component)でも next-intl が
// 環境に応じた実装を提供するので RSC でそのまま使える(getTranslations の async 不要)。
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const t = useTranslations("a11y");
  return (
    <nav aria-label={t("breadcrumb")} className="text-xs text-zinc-500 dark:text-zinc-400">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1">
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-blue-600 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined} className={isLast ? "text-zinc-700 dark:text-zinc-300" : undefined}>
                  {item.label}
                </span>
              )}
              {!isLast && <span aria-hidden className="text-zinc-300 dark:text-zinc-600">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
