import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { AreaJsonLd } from "@/components/seo/AreaJsonLd";
import { AccessChip } from "@/components/seo/AccessChip";
import { findArea, relatedAreas, type Area } from "@/lib/areas";
import { getRegionCount, getToiletsInRegion } from "@/lib/toilets";
import { toiletAccessKey, toiletDisplayName } from "@/lib/toiletSeo";
import { absUrl, languageAlternates, inLanguageOf } from "@/lib/urls";
import type { Toilet } from "@/types/toilet";

export const revalidate = 21600; // 6h
export const dynamicParams = true; // 初回アクセス時にレンダリング → ISR キャッシュ。未知 slug は notFound()。

// 空配列 = ビルド時は事前生成せず全件オンデマンド ISR(ビルド時の Supabase 呼び出しを避ける)。
export function generateStaticParams(): { region: string }[] {
  return [];
}

const LIST_LIMIT = 180;

async function loadArea(
  region: string
): Promise<{ area: Area; count: number; toilets: Toilet[] } | null> {
  const area = findArea(region);
  if (!area) return null;
  const [count, toilets] = await Promise.all([
    getRegionCount(area.bbox),
    getToiletsInRegion(area.bbox, LIST_LIMIT),
  ]);
  return { area, count, toilets };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; region: string }>;
}): Promise<Metadata> {
  const { locale, region } = await params;
  const data = await loadArea(region);
  const t = await getTranslations({ locale, namespace: "areaPage" });
  if (!data) return { title: "Not found", robots: { index: false, follow: false } };
  const path = `/area/${data.area.slug}`;
  const title = t("heading", { label: data.area.label });
  const description = t("metaDescription", { label: data.area.label, count: data.count });
  return {
    title,
    description,
    alternates: { canonical: absUrl(locale, path), languages: languageAlternates(path) },
    openGraph: { title, description, url: absUrl(locale, path) },
    robots: { index: data.count > 0, follow: true },
  };
}

export default async function AreaPage({
  params,
}: {
  params: Promise<{ locale: string; region: string }>;
}) {
  const { locale, region } = await params;
  setRequestLocale(locale);
  const data = await loadArea(region);
  if (!data) notFound();
  const { area, count, toilets } = data;

  const t = await getTranslations("areaPage");
  const tn = await getTranslations("nav");
  const path = `/area/${area.slug}`;
  const heading = t("heading", { label: area.label });
  const related = relatedAreas(area);

  return (
    <article className="mx-auto max-w-2xl space-y-5 px-4 py-8 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        {tn("backToMap")}
      </Link>
      <Breadcrumbs items={[{ label: t("breadcrumbHome"), href: "/" }, { label: area.label }]} />
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{heading}</h1>
      <p>{t("intro", { label: area.label })}</p>
      <p className="text-zinc-500 dark:text-zinc-400">{t("countLine", { count })}</p>
      <Link
        href="/"
        className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow hover:bg-blue-700"
      >
        {t("viewAreaOnMap")}
      </Link>

      {toilets.length > 0 ? (
        <section>
          <h2 className="pb-1 pt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {t("listHeading")}
          </h2>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {toilets.map((toilet) => (
              <AreaToiletRow key={toilet.id} toilet={toilet} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          {t("empty")}
        </p>
      )}

      <h2 className="pt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("otherAreas")}</h2>
      <ul className="flex flex-wrap gap-2">
        {related.map((a) => (
          <li key={a.slug}>
            <Link
              href={`/area/${a.slug}`}
              className="inline-block rounded-full bg-zinc-100 px-3 py-1 text-xs text-blue-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-blue-300 dark:hover:bg-zinc-700"
            >
              {a.label}
            </Link>
          </li>
        ))}
        <li>
          <Link
            href="/about"
            className="inline-block rounded-full bg-zinc-100 px-3 py-1 text-xs text-blue-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-blue-300 dark:hover:bg-zinc-700"
          >
            {tn("about")}
          </Link>
        </li>
      </ul>

      <AreaJsonLd
        name={heading}
        url={absUrl(locale, path)}
        description={t("metaDescription", { label: area.label, count })}
        areaName={area.label}
        isPrefecture={area.kind === "prefecture"}
        inLanguage={inLanguageOf(locale)}
        breadcrumb={[
          { name: t("breadcrumbHome"), url: absUrl(locale, "") },
          { name: area.label, url: absUrl(locale, path) },
        ]}
      />
    </article>
  );
}

// 一覧の各行。async サーバーコンポーネント(getTranslations は request スコープでキャッシュされる)。
async function AreaToiletRow({ toilet }: { toilet: Toilet }) {
  const ta = await getTranslations("access");
  const tp = await getTranslations("pinSheet");
  const access = toiletAccessKey(toilet);
  const name = toiletDisplayName(toilet, tp("unnamed"));
  return (
    <li className="py-2">
      <Link
        href={`/toilet/${toilet.id}`}
        className="flex items-center justify-between gap-2 hover:text-blue-700"
      >
        <span className="min-w-0 truncate">{name}</span>
        <span className="flex shrink-0 items-center gap-2">
          {toilet.review_count >= 10 && toilet.avg_rating != null && (
            <span className="text-xs text-amber-600">★ {toilet.avg_rating.toFixed(1)}</span>
          )}
          <AccessChip
            level={access}
            label={access ? ta(`${access}.label`) : tp("noRating")}
            size="sm"
          />
        </span>
      </Link>
    </li>
  );
}
