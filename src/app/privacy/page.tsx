import Link from "next/link";

export const metadata = { title: "プライバシーポリシー" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-4 px-4 py-8 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        ← マップに戻る
      </Link>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        プライバシーポリシー
      </h1>
      <p>
        本サービス「ピットイン」(以下「本サービス」)は、ユーザーのプライバシーを最大限尊重し、個人情報保護法および関連法令を遵守して運営します。
      </p>

      <h2 className="pt-4 text-lg font-semibold">収集する情報</h2>
      <ul className="list-disc pl-5">
        <li>位置情報: トイレ検索の際に一時的にブラウザから取得し、サーバー側には保存しません。</li>
        <li>レビュー投稿内容: 星評価・利用許可区分・ウォシュレット有無・コメント(任意)。</li>
        <li>送信元 IP アドレス: スパム防止目的で SHA256 ハッシュ化し保存します(原 IP は保存しません)。</li>
      </ul>

      <h2 className="pt-4 text-lg font-semibold">第三者提供</h2>
      <p>
        収集した情報を第三者に提供することはありません。広告配信のための匿名化集計データのみ、提携先と共有する場合があります。
      </p>

      <h2 className="pt-4 text-lg font-semibold">解析ツール</h2>
      <p>
        本サービスは Vercel Analytics / Speed Insights を利用してアクセス状況を匿名で計測しています。
      </p>

      <h2 className="pt-4 text-lg font-semibold">お問い合わせ</h2>
      <p>
        サポート連絡先: <a className="text-blue-600 underline" href="mailto:tosagiken.info@gmail.com">tosagiken.info@gmail.com</a>
      </p>

      <p className="pt-6 text-xs text-zinc-500">最終更新: 2026-05-08</p>
    </article>
  );
}
