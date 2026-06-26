import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { absUrl, languageAlternates, baseOpenGraph } from "@/lib/urls";
import { CONTACT_FORM_URL } from "@/lib/contact";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });
  const path = "/contact";
  return {
    title: t("metaTitle"),
    // #36
    description: t("metaDescription"),
    alternates: { canonical: absUrl(locale, path), languages: languageAlternates(path) },
    // #34
    openGraph: { ...baseOpenGraph(locale), title: t("metaTitle"), description: t("metaDescription"), url: absUrl(locale, path) },
    // #34 C6 — layout デフォルト済み。冗長除去。
  };
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contact");
  const tn = await getTranslations("nav");
  const tl = await getTranslations("legalNotice");
  const isJa = locale === routing.defaultLocale;

  return (
    <article className="mx-auto max-w-2xl space-y-5 px-4 py-8 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      {/* WHY: テキストリンク(16px)→ 明確な filled ボタン(44px)に変更。Google 流入をアプリに送客する導線強化 + WCAG 2.5.5 タップ領域確保 */}
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        {tn("backToMap")}
      </Link>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>

      {!isJa && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {tl("translationNote")}
        </p>
      )}

      <p>{t("intro")}</p>

      <a
        href={CONTACT_FORM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-base font-semibold text-white shadow hover:bg-blue-700 active:scale-[0.99]"
      >
        <ExternalLink className="h-4 w-4" />
        {t("openForm")}
      </a>

      <h2 className="pt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("helpfulTitle")}</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>{t("helpful1")}</li>
        <li>{t("helpful2")}</li>
        <li>{t("helpful3")}</li>
        <li>{t("helpful4")}</li>
      </ul>

      <h2 className="pt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("reportTitle")}</h2>
      <p>{t("reportBody")}</p>
    </article>
  );
}
