import { getTranslations, setRequestLocale } from "next-intl/server";
import { ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { CONTACT_FORM_URL } from "@/lib/contact";

export const metadata = { title: "ご意見・ご要望 / Feedback" };

export default async function ContactPage({
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
    <article className="mx-auto max-w-2xl space-y-5 px-4 py-8 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        {tn("backToMap")}
      </Link>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{tn("feedback")}</h1>

      {!isJa && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {tl("japaneseOnly")}
        </p>
      )}

      <p>
        Loo map へのバグ報告・トイレ情報の誤り・機能要望・感想など、お気軽にどうぞ。匿名で送信できます。
      </p>

      <a
        href={CONTACT_FORM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-base font-semibold text-white shadow hover:bg-blue-700 active:scale-[0.99]"
      >
        <ExternalLink className="h-4 w-4" />
        フィードバックフォームを開く / Open feedback form
      </a>

      <h2 className="pt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        書いてもらえると助かること
      </h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>バグ報告: どの画面で・何をしたら・どうなったか</li>
        <li>使用していた端末 / ブラウザ</li>
        <li>トイレ情報の誤り: 該当トイレの共有 URL(ピン詳細の共有ボタンから取得できます)</li>
        <li>スクリーンショット(あれば URL を貼ってください)</li>
      </ul>

      <h2 className="pt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        「ここはトイレがない / 使えなかった」報告について
      </h2>
      <p>
        個別のトイレについては、アプリ内でそのピンをタップ →
        「ここはトイレがない・使えなかった と報告」からも送れます。複数報告が集まると自動的に地図から非表示になります。
      </p>
    </article>
  );
}
