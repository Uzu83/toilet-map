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

import { Star } from "lucide-react";

type StarsSize = "sm" | "md";

type Props = {
  value: number;
  size?: StarsSize;
};

export function Stars({ value, size = "md" }: Props) {
  const cls = size === "sm"
    ? { filled: "h-3 w-3 fill-amber-400 text-amber-400", empty: "h-3 w-3 text-zinc-300 dark:text-zinc-600" }
    : { filled: "h-4 w-4 fill-amber-400 text-amber-400", empty: "h-4 w-4 text-zinc-300 dark:text-zinc-600" };

  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={i <= Math.round(value) ? cls.filled : cls.empty}
        />
      ))}
    </div>
  );
}
