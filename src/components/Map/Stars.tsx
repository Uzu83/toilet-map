"use client";

// Stars — 星 1-5 の rating 表示コンポーネント。PinSheet と ToiletList の両方で使う。
//
// WHY 独立コンポーネントに抽出するか:
//   PinSheet と ToiletList はそれぞれ局所的に Stars 関数を定義していたが、
//   サイズ指定(h-4/w-4 vs h-3/w-3)以外はまったく同じロジックだった。
//   1 箇所を直すと他方に反映されない「サイレントドリフト」が起きやすいため、
//   size prop で切り替える共通コンポーネントに統一する。
//
// WHY size prop の既定値を PinSheet の "md"(h-4/w-4)にするか:
//   PinSheet はメインの詳細表示なのでより大きく見せる。ToiletList は一覧行の
//   コンパクト表示なので小さい "sm"(h-3/w-3)を使う。デフォルトを大きい側にしておくと
//   新規呼び出し元がサイズ未指定で追加しても視認性が保たれる。
//
// WHY reviewCount を渡すと a11y 代替テキストを出すか(role="img" + aria-label):
//   5 個の星 SVG はそれぞれには意味がなく、SR が「5 つの画像」と読み上げても無意味。
//   グループを 1 つの画像として「★4.2、レビュー15件」と読ませる(WCAG 1.1.1 代替テキスト)。
//   個々の星は aria-hidden。reviewCount 未指定の呼び出しは純粋な装飾として扱い aria を出さない。
//   元々は PinSheet/ToiletList が各々ローカル Stars に aria を実装していたが(a11y 改善 Tranche A)、
//   #13 で共通 Stars に抽出済みだったため、rebase 時に a11y をこの共通側へ集約した
//   (二重実装を避け、全呼び出し元に同じ代替テキストが効くようにする)。

import { Star } from "lucide-react";
import { useTranslations } from "next-intl";

type StarsSize = "sm" | "md";

type Props = {
  value: number;
  size?: StarsSize;
  // 渡すと SR 用の代替テキストを付ける(レビュー数を文言に含めるため必須情報)。
  // 未指定 = 装飾扱い(aria を出さない)。
  reviewCount?: number;
};

export function Stars({ value, size = "md", reviewCount }: Props) {
  const ta = useTranslations("a11y");
  const cls =
    size === "sm"
      ? { filled: "h-3 w-3 fill-amber-400 text-amber-400", empty: "h-3 w-3 text-zinc-300 dark:text-zinc-600" }
      : { filled: "h-4 w-4 fill-amber-400 text-amber-400", empty: "h-4 w-4 text-zinc-300 dark:text-zinc-600" };

  // reviewCount 未指定なら aria なし(装飾)。0 件=評価不足 / 1件以上=★X.X、N件。
  const label =
    reviewCount === undefined
      ? undefined
      : reviewCount > 0
        ? ta("starRating", { rating: value.toFixed(1), count: reviewCount })
        : ta("starRatingNone");

  return (
    <div className="flex" role={label ? "img" : undefined} aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden={label ? true : undefined}
          className={i <= Math.round(value) ? cls.filled : cls.empty}
        />
      ))}
    </div>
  );
}
