import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { FaqJsonLd } from "@/components/seo/FaqJsonLd";
import { buildBreadcrumbList } from "@/components/seo/jsonLdHelpers";
import { absUrl, languageAlternates, baseOpenGraph } from "@/lib/urls";
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  const path = "/about";
  return {
    // #37 — layout template は "%s | Loo map"。about.title が "Loo map の使い方…" を含むと
    // "Loo map の使い方… | Loo map" のように Loo map が二重になる。
    // { absolute: } を使うことでテンプレートを無視して文言をそのまま使い、ブランドの重複を防ぐ。
    // visible h1 は t("title") のままなので表示に変化なし(メタタグだけの修正)。
    title: { absolute: t("title") },
    description: t("metaDescription"),
    alternates: { canonical: absUrl(locale, path), languages: languageAlternates(path) },
    // #34 — og:locale/type/siteName を baseOpenGraph で確実に維持する(浅いマージ対策)。
    openGraph: { ...baseOpenGraph(locale), title: t("title"), description: t("metaDescription"), url: absUrl(locale, path) },
    // #34 C6 — layout がデフォルト { index: true, follow: true } を設定済み。冗長な重複を除去。
  };
}

// about ページで FEATURED_AREA_SLUGS を export する理由:
//   home ページ(#40)が同じリストでポピュラーエリアチップを描画するため。
//   ここで定義することで単一ソースを維持し、順序変更が両ページに即反映される。
export const FEATURED_AREA_SLUGS = ["fukuoka-city", "tokyo-23", "jp-13", "jp-27", "jp-01", "jp-40"];

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
      {/*
        WHY (bg-blue-600 px-4 rounded-full ボタン化の理由):
          旧実装は text-xs・padding 無しのテキストリンク(実寸 ≈ 16px)で、SSR ページへの
          Google 検索流入ユーザーがアプリに戻る導線として著しく affordance が低かった。
          明確なボタン形状(filled・rounded-full・min-h-11)にすることで:
          1) タップ領域 44px を確保(WCAG 2.5.5 目安)
          2) CTA として視覚的に目立ち「地図に戻れる」ことが一目で分かる
          3) Google 流入をアプリに送客する最重要導線を強化する。
          hover・focus-visible リングも付けてキーボード操作でも見えやすくする。
          inline-flex gap-1.5 で → アイコン + テキストの可読性を確保。
      */}
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        {tn("backToMap")}
      </Link>
      {/* #38a — 最初のパンくずラベルを about.breadcrumbHome から取得。
           旧実装は tn("about")("ヘルプ")を使っていたが、ホームのパンくずは "ホーム/Home/홈/首页" が正しい。
           tn("about") は nav メニューラベルであり、パンくずの Home ラベルとは意味が違う。 */}
      <Breadcrumbs items={[{ label: t("breadcrumbHome"), href: "/" }, { label: t("title") }]} />
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
      {/* #38b — /about の BreadcrumbList JSON-LD。Home → about.title の 2 クラム構造。
           areaPage / toiletPage と同じ buildBreadcrumbList を使い実装の統一を保つ。 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              buildBreadcrumbList([
                { name: t("breadcrumbHome"), url: absUrl(locale, "") },
                { name: t("title"), url: absUrl(locale, "/about") },
              ]),
            ],
          }),
        }}
      />
    </article>
  );
}
