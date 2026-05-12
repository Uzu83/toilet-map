import { Link } from "@/i18n/navigation";

export type Crumb = { label: string; href?: string };

// 可視パンくず(JSON-LD は別コンポーネント)。href があればロケール付きリンク。
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400">
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
