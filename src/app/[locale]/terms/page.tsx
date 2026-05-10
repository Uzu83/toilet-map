import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export const metadata = { title: "利用規約 / Terms of Service" };

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tn = await getTranslations("nav");
  const tl = await getTranslations("legalNotice");
  const isJa = locale === routing.defaultLocale;
  return (
    <article className="mx-auto max-w-2xl space-y-4 px-4 py-8 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        {tn("backToMap")}
      </Link>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">利用規約</h1>
      {!isJa && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {tl("japaneseOnly")}
        </p>
      )}

      <h2 className="pt-4 text-lg font-semibold">1. サービスの目的</h2>
      <p>
        本サービス「Loo map」(以下「本サービス」)は、ユーザーが近隣の公衆トイレを快適に発見できるよう、地図表示と評価機能を提供するものです。
      </p>

      <h2 className="pt-4 text-lg font-semibold">2. 禁止事項</h2>
      <ul className="list-disc pl-5">
        <li>個人宅など公衆トイレ以外の登録</li>
        <li>誤った位置情報や虚偽のレビューの投稿</li>
        <li>スパム・嫌がらせ・不適切な言語の使用</li>
        <li>本サービスの運営を妨げる行為</li>
      </ul>

      <h2 className="pt-4 text-lg font-semibold">3. 投稿内容について</h2>
      <p>
        投稿された情報はユーザー自身の体験に基づくものとし、運営者は内容の正確性を保証しません。トイレの実際の利用可否や清潔度はユーザー判断でご利用ください。
      </p>

      <h2 className="pt-4 text-lg font-semibold">4. データソース</h2>
      <p>
        トイレの位置データは <a className="text-blue-600 underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors の提供を ODbL ライセンスのもと利用しています。
      </p>

      <h2 className="pt-4 text-lg font-semibold">5. 免責事項</h2>
      <p>
        本サービスの利用に伴い発生したいかなる損害についても、運営者は一切の責任を負いません。
      </p>

      <h2 className="pt-4 text-lg font-semibold">6. お問い合わせ</h2>
      <p>
        運営者連絡先: <a className="text-blue-600 underline" href="mailto:tosagiken.info@gmail.com">tosagiken.info@gmail.com</a>
      </p>

      <p className="pt-6 text-xs text-zinc-500">最終更新: 2026-05-08</p>
    </article>
  );
}
