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
import { absUrl, languageAlternates, localePrefix, inLanguageOf, baseOpenGraph } from "@/lib/urls";
import { formatDistance, haversineMeters } from "@/lib/geo";
import type { Toilet } from "@/types/toilet";

// このルートは常に動的レンダリング(force-dynamic = ISR キャッシュに書かない)。
//
// [P0 / 2026-06-25] WHY force-dynamic にしたか(背景 → 決定 → 根拠 → 帰結 → 検証):
//   背景: 本番 ~80,450 トイレのうち indexable は ~1,436 件のみ(007 述語: レビュー有り or 名前付き OSM)。
//     残り ~78,500 件 × 4 ロケール ≈ 31 万 URL は noindex だが、クローラが既知 URL を巡回するたび
//     on-demand ISR で生成され(cache=MISS 毎に 1 ISR Write)、Vercel Hobby の ISR Writes
//     200K/月 の ~32%(63,639)を消費していた(本番 runtime ログで /{locale}/toilet/{uuid} の
//     連続 cache=MISS を実測 = 確定診断)。`noindex` はページ生成(=Write)を止めない。
//     リンク削除(A+C)も Googlebot が既に発見済みの URL の再クロールは止められない。
//   決定: ルート全体を動的レンダリングにし prerender キャッシュ entry を作らない = ISR Write 0。
//     代わりにリクエスト毎 SSR(= 1 Function Invocation。Hobby 1M/月 枠内、~31 万規模)。
//   なぜ revalidate(ISR)や他案でなく force-dynamic か(Codex 異モデルレビュー 2 サイクルで合意):
//     - 「revalidate route 内でリクエスト単位に non-indexable だけ connection() で動的化」案は
//       Next 16 docs で裏付けられない undocumented 挙動 → 不採用(本番の不変条件を賭けない)。
//     - 「generateStaticParams=indexable + dynamicParams=false で non-indexable を 404」案は
//       新たに indexable 化したトイレを出すのに再デプロイが要る(レビュー累積で恒常的運用負債)+
//       共有リンクが 404 になる → 不採用。
//   帰結 / トレードオフ: indexable ページ(~1,436×4)も ISR キャッシュを失い SSR になる。件数が
//     少なく repeat も低いのでコストは軽微、かつ常に最新データになる利点もある。force-dynamic は
//     generateMetadata 含めルート全体を動的化するので metadata 由来の Write も出ない(Codex 確認)。
//   ⚠️ デプロイ後の live 検証必須(vitest 不能 = キャッシュは実行時挙動): preview で
//     `x-vercel-cache` が durable HIT にならない(=書いていない)こと + Vercel Usage で ISR Writes
//     が下降し Invocations / Active CPU(4h) / Provisioned Memory(360GB-hrs)が枠内であることを
//     確認してから本番昇格する。逼迫が見えたら C(非 indexable の 4 ロケール集約)を追加。
//   ※ 旧 `revalidate`/`dynamicParams`/`generateStaticParams` は force-dynamic 下で無意味なので削除。
export const dynamic = "force-dynamic";

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
    // #34 — og:locale/type/siteName を確保(浅いマージ対策)。
    // ただし robots の conditional logic は変えない(A+C fix を維持)。
    openGraph: { ...baseOpenGraph(locale), title, description, url: absUrl(locale, path) },
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

  // [P0 軽量化 / 2026-06-25] non-indexable では近傍クエリ(getNearbyToilets → PostGIS の
  //   toilets_in_region)をスキップする。
  //   WHY: force-dynamic で ISR Write は Function Invocation + DB read に振り替わる。non-indexable
  //   (~31 万 URL のクローラ流入)は noindex で「近くのトイレ」節に検索価値がないため、重い
  //   PostGIS クエリを省いて 1 リクエストあたりの DB / Active CPU 負荷を抑える(Codex 合意 Q2/Q5)。
  //   indexable(検索対象・少数)は従来通り近傍を出す。getToiletById は cache() 済みなので
  //   metadata と本体で 1 回に重複排除される(= non-indexable は実質 DB 1 read)。
  const showNearby = isToiletIndexable(toilet);
  const nearby = showNearby ? await getNearbyToilets(toilet) : [];

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

      {/* non-indexable は近傍節ごと省略(上記 showNearby で getNearbyToilets もスキップ済み)。
          indexable は従来通り(近傍 0 件なら noNearby を表示)。 */}
      {showNearby && (
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
      )}

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
