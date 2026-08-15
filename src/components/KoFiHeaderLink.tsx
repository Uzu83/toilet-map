"use client";

import { KO_FI_URL } from "@/lib/contact";
import { trackEvent } from "@/lib/analytics";

type Props = {
  label: string;
  className?: string;
};

/** ヘッダ等の Ko-fi リンク。クリックを ko_fi_click で計装する。 */
export function KoFiHeaderLink({ label, className }: Props) {
  return (
    <a
      href={KO_FI_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackEvent("ko_fi_click", { source: "header" })}
      className={className}
    >
      ☕ {label}
    </a>
  );
}
