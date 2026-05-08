"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 本番では Vercel ログに残る。Sentry 等は Phase 2 で
    console.error("[ErrorBoundary]", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full w-full place-items-center bg-zinc-50 p-6 dark:bg-zinc-950">
        <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
          <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-amber-500" />
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            画面の表示中にエラーが発生しました
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            一時的な問題かもしれません。再読み込みをお試しください。
          </p>
          <p className="mt-2 break-all rounded bg-zinc-100 p-2 text-left text-[10px] font-mono text-zinc-500 dark:bg-zinc-800">
            {this.state.error.message}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="flex h-10 flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <RefreshCw className="h-4 w-4" />
              再試行
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") window.location.assign("/");
              }}
              className="flex h-10 flex-1 items-center justify-center rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              トップへ
            </button>
          </div>
        </div>
      </div>
    );
  }
}
