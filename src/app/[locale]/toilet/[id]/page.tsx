import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { AccessChip } from "@/components/seo/AccessChip";
import { ToiletJsonLd } from "@/components/seo/ToiletJsonLd";
import { getNearbyToilets, getToiletById } from "@/lib/toilets";
import {
  isToiletIndexable, // ISR Writes 止血: non-indexable トイレへの <a> を消す(A+C)
  isToiletUnconfirmed,
  toiletAccessKey,
  toiletAmenityKeys,
  toiletDisplayName,
} from "@/lib/toiletSeo";
import { findContainingPrefecture, areaLabel } from "@/lib/areas";
import { absUrl, languageAlternates, localePrefix, inLanguageOf } from "@/lib/urls";
import { formatDistance, haversineMeters } from "@/lib/geo";
import type { Toilet } from "@/types/toilet";

// 30日(トイレ/レビュー数はほぼ変わらない & 約8万ページ × 4 ロケールあるので、
// クローラ巡回のたびに再生成すると ISR Writes が無料枠を即溢れさせる)。
export const revalidate = 2592000;
export const dynamicParams = true;

// 空配列 = ビルド時は事前生成せず、初回アクセス時にレンダリング → ISR キャッシュ。
export function generateStaticParams(): { id: string }[] {
  return [];
}

// レビュー10件未満は清潔度を出さない。タイトル例(ja): "博多駅前公衆トイレ — 声かけ不要"
async function buildTitle(locale: string, toilet: Toilet): Promise<string> {
  const tp = await getTranslations({ locale, namespace: "pinSheet" });
  const ta = await getTranslations({ locale, namespace: "access" });
  const tt = await getTranslations({ locale, namespace: "toiletPage" });
  const name = toiletDisplayName(toilet, tp("unnamed"));
  const access = toiletAccessKey(toilet);
  const parts: string[] = [];
  if (access) parts.push(ta(`${access}.label`));
  if (toilet.review_count >= 10 && toilet.avg_rating != null) {
    parts.push(`${tt("cleanlinessLabel")} ${toilet.avg_rating.toFixed(1)}`);
  }
  return parts.length ? `${name} — ${parts.join(" / ")}` : name;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const toilet = await getToiletById(id);
  if (!toilet || toilet.not_a_toilet_count >= 5) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  const tp = await getTranslations({ locale, namespace: "pinSheet" });
  const tt = await getTranslations({ locale, namespace: "toiletPage" });
  const name = toiletDisplayName(toilet, tp("unnamed"));
  const path = `/toilet/${toilet.id}`;
  const title = await buildTitle(locale, toilet);
  const description = tt("metaDescription", { name });
  return {
    title,
    description,
    alternates: { canonical: absUrl(locale, path), languages: languageAlternates(path) },
    openGraph: { title, description, url: absUrl(locale, path) },
    // C: non-indexable ページは follow も false にする(多層防御)。
    // noindex のままで follow=true だと、クローラが <a href> を辿って
    // 別の non-indexable UUID を次々 ISR 生成し Writes 枠を食い潰す。
    // noindex,nofollow にすることでリンクグラフ探索を本ページで断ち切る。
    // 残ったエントリポイント(/api/toilets bbox API 経由の UUID)は本修正スコープ外 — デプロイ後ログで評価。
    robots: { index: isToiletIndexable(toilet), follow: isToiletIndexable(toilet) },
  };
}

export default async function ToiletPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const toilet = await getToiletById(id);
  if (!toilet || toilet.not_a_toilet_count >= 5) notFound();

  const tt = await getTranslations("toiletPage");
  const tp = await getTranslations("pinSheet");
  const ta = await getTranslations("access");
  const tn = await getTranslations("nav");
  const tan = await getTranslations("areaNames");

  const name = toiletDisplayName(toilet, tp("unnamed"));
  const access = toiletAccessKey(toilet);
  const amenityKeys = toiletAmenityKeys(toilet);
  const unconfirmed = isToiletUnconfirmed(toilet);
  const path = `/toilet/${toilet.id}`;
  const mapHref = `${localePrefix(locale)}/?id=${toilet.id}`;
  const gmapsHref = `https://www.google.com/maps/search/?api=1&query=${toilet.lat},${toilet.lng}`;
  const area = findContainingPrefecture(toilet.lat, toilet.lng);
  const areaName = area ? areaLabel(area, tan) : null;
  const nearby = await getNearbyToilets(toilet);

  const crumbs: { label: string; href?: string }[] = [
    { label: tt("breadcrumbHome"), href: "/" },
    ...(area && areaName ? [{ label: areaName, href: `/area/${area.slug}` }] : []),
    { label: name },
  ];
  const jsonLdCrumbs = [
    { name: tt("breadcrumbHome"), url: absUrl(locale, "") },
    ...(area && areaName ? [{ name: areaName, url: absUrl(locale, `/area/${area.slug}`) }] : []),
    { name, url: absUrl(locale, path) },
  ];

  return (
    <article className="mx-auto max-w-2xl space-y-5 px-4 py-8 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        {tn("backToMap")}
      </Link>
      <Breadcrumbs items={crumbs} />

      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <AccessChip level={access} label={access ? ta(`${access}.label`) : tp("noRating")} />
          {unconfirmed && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              {tp("unconfirmed")}
            </span>
          )}
        </div>
        {access && <p className="text-zinc-500 dark:text-zinc-400">{ta(`${access}.desc`)}</p>}
      </header>

      <dl className="grid gap-2">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-zinc-500 dark:text-zinc-400">{tt("cleanlinessLabel")}</dt>
          <dd>
            {toilet.avg_rating != null ? (
              <>
                ★ {toilet.avg_rating.toFixed(1)}{" "}
                <span className="text-zinc-400">
                  ({tt("ratingCount", { count: toilet.review_count })}
                  {toilet.review_count > 0 && toilet.review_count < 10 ? ` · ${tp("ratingNote")}` : ""})
                </span>
              </>
            ) : (
              <span className="text-zinc-400">{tt("noRating")}</span>
            )}
          </dd>
        </div>
        {amenityKeys.length > 0 && (
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-zinc-500 dark:text-zinc-400">{tt("amenitiesLabel")}</dt>
            <dd>{amenityKeys.map((k) => tt(k)).join(" / ")}</dd>
          </div>
        )}
        {toilet.opening_hours && (
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-zinc-500 dark:text-zinc-400">{tt("hoursLabel")}</dt>
            <dd className="font-mono text-xs">{toilet.opening_hours}</dd>
          </div>
        )}
      </dl>

      {unconfirmed && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {tt("unconfirmedNote")}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <a
          href={mapHref}
          className="flex h-12 items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white shadow hover:bg-blue-700 active:scale-[0.99]"
        >
          {tt("viewOnMap")}
        </a>
        <a
          href={gmapsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-12 items-center justify-center rounded-lg border border-zinc-300 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {tt("openInGoogleMaps")}
        </a>
      </div>

      <section>
        <h2 className="pb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{tt("nearbyTitle")}</h2>
        {nearby.length > 0 ? (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {nearby.map((n) => (
              <NearbyRow key={n.id} from={toilet} toilet={n} />
            ))}
          </ul>
        ) : (
          <p className="text-zinc-500 dark:text-zinc-400">{tt("noNearby")}</p>
        )}
      </section>

      <ul className="flex flex-wrap gap-2 pt-2">
        {area && areaName && (
          <li>
            <Link
              href={`/area/${area.slug}`}
              className="inline-block rounded-full bg-zinc-100 px-3 py-1 text-xs text-blue-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-blue-300 dark:hover:bg-zinc-700"
            >
              {tt("relatedAreaPrefix")} {areaName}
            </Link>
          </li>
        )}
        <li>
          <Link
            href="/about"
            className="inline-block rounded-full bg-zinc-100 px-3 py-1 text-xs text-blue-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-blue-300 dark:hover:bg-zinc-700"
          >
            {tn("about")}
          </Link>
        </li>
      </ul>

      <ToiletJsonLd
        toilet={toilet}
        name={name}
        url={absUrl(locale, path)}
        inLanguage={inLanguageOf(locale)}
        amenityLabels={amenityKeys.map((k) => tt(k))}
        breadcrumb={jsonLdCrumbs}
      />
    </article>
  );
}

async function NearbyRow({ from, toilet }: { from: Toilet; toilet: Toilet }) {
  const ta = await getTranslations("access");
  const tp = await getTranslations("pinSheet");
  const access = toiletAccessKey(toilet);
  const name = toiletDisplayName(toilet, tp("unnamed"));
  const dist = formatDistance(haversineMeters(from, toilet));
  const indexable = isToiletIndexable(toilet);

  // A: ISR Writes 止血 — non-indexable トイレへのクロール可能 <a href> を消す。
  //
  // 背景: /toilet/[id] は dynamicParams=true で ~80,450 件 × 4 ロケール ≈ 320,000 ページが
  // on-demand 生成可能。クローラがこのリンクを辿ると non-indexable UUID も次々 ISR 生成
  // (cache=MISS 毎に 1 ISR Write)し、無料枠 200,000 を急速消費することを本番ログで確認。
  //
  // UUID は uuid v4 で予測不可能なため、HTML に <a href> リンクを置かなければ検索 bot は
  // URL を発見できない(列挙不可 = discovery を断てる)。
  //
  // non-indexable の場合: 行自体は表示し続けるが <Link> を外し <div> のプレーン表示にする。
  // これにより「近くのトイレ」の存在はユーザーに見えるが bot はリンクを辿れない。
  //
  // 残リスク: PinSheet 共有URL / /api/toilets bbox API 経由の UUID 合成は対象外 — デプロイ後ログで再評価。
  const inner = (
    <span className="flex items-center justify-between gap-2 w-full">
      <span className="min-w-0 truncate">{name}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-zinc-400">{dist}</span>
        <AccessChip level={access} label={access ? ta(`${access}.label`) : tp("noRating")} size="sm" />
      </span>
    </span>
  );

  return (
    <li className="py-2">
      {indexable ? (
        // indexable: <Link> でクローラが辿れる通常リンク
        <Link href={`/toilet/${toilet.id}`} className="flex items-center justify-between gap-2 hover:text-blue-700">
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
