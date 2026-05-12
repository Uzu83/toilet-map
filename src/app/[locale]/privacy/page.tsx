import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { absUrl, languageAlternates } from "@/lib/urls";
import { SITE_TEAM } from "@/lib/contact";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacy" });
  const path = "/privacy";
  return {
    title: t("metaTitle"),
    alternates: { canonical: absUrl(locale, path), languages: languageAlternates(path) },
    robots: { index: true, follow: true },
  };
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");
  const tn = await getTranslations("nav");
  const tl = await getTranslations("legalNotice");
  const isJa = locale === routing.defaultLocale;
  return (
    <article className="mx-auto max-w-2xl space-y-4 px-4 py-8 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        {tn("backToMap")}
      </Link>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
      {!isJa && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {tl("translationNote")}
        </p>
      )}
      <p>{t("intro", { team: SITE_TEAM })}</p>

      <h2 className="pt-4 text-lg font-semibold">{t("collectTitle")}</h2>
      <ul className="list-disc pl-5">
        <li>{t("collectLocation")}</li>
        <li>{t("collectReview")}</li>
        <li>{t("collectIp")}</li>
      </ul>

      <h2 className="pt-4 text-lg font-semibold">{t("thirdPartyTitle")}</h2>
      <p>{t("thirdParty")}</p>

      <h2 className="pt-4 text-lg font-semibold">{t("analyticsTitle")}</h2>
      <p>{t("analytics")}</p>

      <h2 className="pt-4 text-lg font-semibold">{t("contactTitle")}</h2>
      <p>
        {t.rich("contactBody", {
          link: (chunks) => (
            <Link href="/contact" className="text-blue-600 underline">
              {chunks}
            </Link>
          ),
        })}
      </p>

      <p className="pt-6 text-xs text-zinc-500">{t("lastUpdated")}</p>
    </article>
  );
}
