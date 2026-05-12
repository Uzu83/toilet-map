import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { FaqJsonLd } from "@/components/seo/FaqJsonLd";
import { absUrl, languageAlternates } from "@/lib/urls";
import { findArea, areaLabel } from "@/lib/areas";
import { SITE_TEAM, CONTACT_FORM_URL } from "@/lib/contact";

const FAQ_KEYS = [
  "howToFind",
  "pinColors",
  "inferred",
  "notEnoughReviews",
  "etiquette",
  "coverage",
  "addToilet",
  "operator",
] as const;

const FEATURED_AREA_SLUGS = ["fukuoka-city", "tokyo-23", "jp-13", "jp-27", "jp-01", "jp-40"];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  const path = "/about";
  return {
    title: t("title"),
    description: t("metaDescription"),
    alternates: { canonical: absUrl(locale, path), languages: languageAlternates(path) },
    openGraph: { title: t("title"), description: t("metaDescription"), url: absUrl(locale, path) },
    robots: { index: true, follow: true },
  };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");
  const tn = await getTranslations("nav");
  const tan = await getTranslations("areaNames");

  const faqItems = FAQ_KEYS.map((k) => ({ q: t(`q_${k}`), a: t(`a_${k}`) }));
  const areas = FEATURED_AREA_SLUGS.map((s) => findArea(s)).filter((a): a is NonNullable<typeof a> => !!a);

  return (
    <article className="mx-auto max-w-2xl space-y-5 px-4 py-8 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        {tn("backToMap")}
      </Link>
      <Breadcrumbs items={[{ label: tn("about"), href: "/" }, { label: t("title") }]} />
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
      <p>{t("intro")}</p>

      <h2 className="pt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("sectionFaq")}</h2>
      <div className="space-y-4">
        {faqItems.map((it, i) => (
          <div key={i}>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{it.q}</h3>
            <p className="mt-1">{it.a}</p>
          </div>
        ))}
      </div>

      <h2 className="pt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("sectionAreas")}</h2>
      <p>{t("areasIntro")}</p>
      <ul className="flex flex-wrap gap-2">
        {areas.map((a) => (
          <li key={a.slug}>
            <Link
              href={`/area/${a.slug}`}
              className="inline-block rounded-full bg-zinc-100 px-3 py-1 text-xs text-blue-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-blue-300 dark:hover:bg-zinc-700"
            >
              {areaLabel(a, tan)}
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="pt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("sectionOperator")}</h2>
      <p>{t("operatorLine", { team: SITE_TEAM })}</p>
      <ul className="flex flex-wrap gap-3 text-xs text-blue-600">
        <li>
          <a href={CONTACT_FORM_URL} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {tn("feedback")}
          </a>
        </li>
        <li>
          <Link href="/privacy" className="hover:underline">
            {tn("privacy")}
          </Link>
        </li>
        <li>
          <Link href="/terms" className="hover:underline">
            {tn("terms")}
          </Link>
        </li>
      </ul>

      <FaqJsonLd items={faqItems} />
    </article>
  );
}
