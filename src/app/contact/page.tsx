import Link from "next/link";
import { ExternalLink, Mail } from "lucide-react";

export const metadata = { title: "ご意見・ご要望" };

const FEEDBACK_FORM_URL = "https://forms.gle/iKxY3vB6tg4t4vTW9";

export default function ContactPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-5 px-4 py-8 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        ← マップに戻る
      </Link>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        ご意見・ご要望
      </h1>
      <p>
        Loo map へのバグ報告・トイレ情報の誤り・機能要望・感想など、お気軽にどうぞ。匿名で送信できます。
      </p>

      <a
        href={FEEDBACK_FORM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-base font-semibold text-white shadow hover:bg-blue-700 active:scale-[0.99]"
      >
        <ExternalLink className="h-4 w-4" />
        フィードバックフォームを開く
      </a>

      <p className="text-xs text-zinc-500">
        フォームが開けない場合はメールでも受け付けています:{" "}
        <a
          className="inline-flex items-center gap-1 text-blue-600 underline"
          href="mailto:tosagiken.info@gmail.com?subject=%5BLoo%20map%5D%20%E3%83%95%E3%82%A3%E3%83%BC%E3%83%89%E3%83%90%E3%83%83%E3%82%AF"
        >
          <Mail className="h-3 w-3" />
          tosagiken.info@gmail.com
        </a>
      </p>

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
