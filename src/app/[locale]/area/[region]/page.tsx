import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { AreaJsonLd } from "@/components/seo/AreaJsonLd";
import { AccessChip } from "@/components/seo/AccessChip";
import { findArea, relatedAreas, areaLabel, type Area } from "@/lib/areas";
import { getRegionCount, getToiletsInRegion } from "@/lib/toilets";
import { isToiletIndexable, toiletAccessKey, toiletDisplayName } from "@/lib/toiletSeo"; // ISR Writes 止血: non-indexable リンク除去(A+C)
// #29: isToiletIndexable は loadArea が返す既取得の toilets に対して適用する。追加 DB 呼び出しなし。
import { absUrl, languageAlternates, inLanguageOf, baseOpenGraph } from "@/lib/urls";
import type { Toilet } from "@/types/toilet";

export const revalidate = 604800; // 7日(件数はシード時くらいしか変わらない。ISR Writes 節約)
export const dynamicParams = true; // 初回アクセス時にレンダリング → ISR キャッシュ。未知 slug は notFound()。

// 空配列 = ビルド時は事前生成せず全件オンデマンド ISR(ビルド時の Supabase 呼び出しを避ける)。
export function generateStaticParams(): { region: string }[] {
  return [];
}

const LIST_LIMIT = 180;

// WHY cache() でラップするか:
//   generateMetadata と page の両方が loadArea を呼ぶ。Supabase-js は fetch-memoization の対象外のため、
//   cache() の per-request memo により同一リクエスト内の二重 DB ラウンドトリップを 1 回に削減する。
//   出力は変わらない(同じ DB に同じ引数で問い合わせるので結果は同一)。
//   ⚠️ cache() のスコープは「サーバーリクエスト単位」。Next の ISR キャッシュとは別物。
const loadArea = cache(async function loadArea(
  region: string
): Promise<{ area: Area; count: number; toilets: Toilet[] } | null> {
  const area = findArea(region);
  if (!area) return null;
  const [count, toilets] = await Promise.all([
    getRegionCount(area.bbox),
    getToiletsInRegion(area.bbox, LIST_LIMIT),
  ]);
  return { area, count, toilets };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; region: string }>;
}): Promise<Metadata> {
  const { locale, region } = await params;
  const data = await loadArea(region);
  const t = await getTranslations({ locale, namespace: "areaPage" });
  if (!data) return { title: "Not found", robots: { index: false, follow: false } };
  const tan = await getTranslations({ locale, namespace: "areaNames" });
  const label = areaLabel(data.area, tan);
  const path = `/area/${data.area.slug}`;
  const title = t("heading", { label });
  const description = t("metaDescription", { label, count: data.count });
  return {
    title,
    description,
    alternates: { canonical: absUrl(locale, path), languages: languageAlternates(path) },
    // #34 — og:locale/type/siteName を確保(浅いマージ対策)。
    openGraph: { ...baseOpenGraph(locale), title, description, url: absUrl(locale, path) },
    // #29 — count > 0 から indexable ベースのゲートへ変更。
    //
    // WHY: count は DB の全件数(RPC toilets_in_region_count)だが、ページが実際にクローラブルな
    // リンクとして見せるのは isToiletIndexable() を満たす toilets のみ(A+C ISR Write 止血の
    // non-indexable リンク除去)。count > 0 のままだと「ページ内に辿れる個別ページリンクが 0 件
    // でも index: true」という不整合が起きる。
    //
    // KNOWN FALSE-NEGATIVE(意図的に受け入れる):
    //   toilets_in_region は review_count desc でソートされる(005:77)。
    //   migration 007 は zero-review の named-OSM トイレも indexable にする(007:34-38)。
    //   これらは review=0 ブロックの末尾に並ぶため、エリアの総件数が LIST_LIMIT(180)を超える場合は
    //   window から外れ data.toilets に含まれない可能性がある。
    //   その場合、zero-review named-OSM トイレが ONLY の indexable toilets なら
    //   このゲートは誤って noindex にする(false-negative)。
    //   ACCEPTED: (a) index-reducing = ISR Write 予算に安全 (b) 個別の /toilet/[id] ページは
    //   sitemap の getIndexableToiletIdsPage 経由で引き続き独立して発見可能。
    //   また、このゲートはページが実際にクローラへ見せるリンク群と整合しているため、
    //   クローラの「リンクを辿って index → 辿れるリンクが 0 件」という矛盾を防げる。
    robots: { index: data.toilets.some(isToiletIndexable), follow: true },
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
  const tan = await getTranslations("areaNames");
  const label = areaLabel(area, tan);
  const path = `/area/${area.slug}`;
  const heading = t("heading", { label });
  const related = relatedAreas(area);

  return (
    <article className="mx-auto max-w-2xl space-y-5 px-4 py-8 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        {tn("backToMap")}
      </Link>
      <Breadcrumbs items={[{ label: t("breadcrumbHome"), href: "/" }, { label }]} />
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{heading}</h1>
      <p>{t("intro", { label })}</p>
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
              {areaLabel(a, tan)}
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
        description={t("metaDescription", { label, count })}
        areaName={label}
        isPrefecture={area.kind === "prefecture"}
        inLanguage={inLanguageOf(locale)}
        breadcrumb={[
          { name: t("breadcrumbHome"), url: absUrl(locale, "") },
          { name: label, url: absUrl(locale, path) },
        ]}
        count={count}
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
  const indexable = isToiletIndexable(toilet);

  // A: ISR Writes 止血 — non-indexable トイレへのクロール可能 <a href> を消す。
  //
  // 背景: クローラがエリアページのトイレ一覧から non-indexable UUID を辿ると
  // /toilet/[id] が on-demand ISR 生成される(cache=MISS = 1 ISR Write)。
  // エリアページは 180 件まで列挙するため、非 indexable 比率が高いと Writes を多量消費する。
  //
  // non-indexable (inferred ピン / review=0 かつ名称なし / not_a_toilet>=5) は
  // <Link> を外し <div> のプレーン表示にする。行自体はユーザーに見えるが bot はリンクを辿れない。
  //
  // NearbyRow(toilet/[id]/page.tsx) にも同じ修正を適用している。
  const inner = (
    <>
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
    </>
  );

  return (
    <li className="py-2">
      {indexable ? (
        // indexable: <Link> でクローラが辿れる通常リンク
        <Link
          href={`/toilet/${toilet.id}`}
          className="flex items-center justify-between gap-2 hover:text-blue-700"
        >
          {inner}
        </Link>
      ) : (
        // non-indexable: <a>/<Link> を一切描画しない。ユーザーには表示するが bot は辿れない。
        // text-zinc-500 でリンク色(blue)を外して非インタラクティブと示唆する。
        <div className="flex items-center justify-between gap-2 text-zinc-500 dark:text-zinc-400">
          {inner}
        </div>
      )}
    </li>
  );
}
