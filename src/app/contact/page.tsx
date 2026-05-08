import Link from "next/link";

export const metadata = { title: "ご意見・ご要望" };

export default function ContactPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-4 px-4 py-8 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        ← マップに戻る
      </Link>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        ご意見・ご要望
      </h1>
      <p>
        バグ報告・機能要望は以下の窓口で受け付けています。お気軽にどうぞ。
      </p>
      <ul className="list-disc pl-5">
        <li>
          メール:{" "}
          <a
            className="text-blue-600 underline"
            href="mailto:tosagiken.info@gmail.com?subject=%5B%E3%83%94%E3%83%83%E3%83%88%E3%82%A4%E3%83%B3%5D"
          >
            tosagiken.info@gmail.com
          </a>
        </li>
        <li>
          Google Form: 共通フィードバック窓口を準備中(覇王が後日 URL を差し込み予定)
        </li>
      </ul>

      <h2 className="pt-4 text-lg font-semibold">送ってほしい情報</h2>
      <ul className="list-disc pl-5">
        <li>使用していた端末/ブラウザ</li>
        <li>再現手順(分かれば)</li>
        <li>スクリーンショット(添付歓迎)</li>
      </ul>
    </article>
  );
}
