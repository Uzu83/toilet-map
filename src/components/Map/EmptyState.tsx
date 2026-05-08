"use client";

import { Search, ZoomOut } from "lucide-react";

export function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-1000 mx-auto max-w-sm px-4">
      <div className="pointer-events-auto rounded-2xl bg-white/95 p-4 text-center shadow-lg ring-1 ring-black/5 backdrop-blur dark:bg-zinc-900/95 dark:ring-white/10">
        {filtered ? (
          <>
            <Search className="mx-auto mb-1 h-5 w-5 text-zinc-400" />
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              条件に合うトイレが見つかりません
            </p>
            <p className="mt-1 text-xs text-zinc-500">フィルタを外すか、別のエリアを試してください</p>
          </>
        ) : (
          <>
            <ZoomOut className="mx-auto mb-1 h-5 w-5 text-zinc-400" />
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              このエリアにはまだトイレ情報がありません
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              ズームアウトする / 別の街に移動する / 投稿するで増やせます
            </p>
          </>
        )}
      </div>
    </div>
  );
}
