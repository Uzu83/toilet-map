"use client";

import { useState, type FormEvent } from "react";
import { startAuthentication } from "@simplewebauthn/browser";

// ログイン後の遷移先。?next= があればそこへ(proxy が付与)、無ければ /admin。
// オープンリダイレクト防止: 自サイト内の絶対パス(/admin 配下)に限定する。
function goNext() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  const dest = next && next.startsWith("/admin") ? next : "/admin";
  window.location.assign(dest);
}

function messageFor(status: number, fallback: string): string {
  if (status === 429) return "試行回数が多すぎます。しばらく待って再度お試しください。";
  if (status === 503) return "サーバー側の設定が未完了です。管理者に連絡してください。";
  return fallback;
}

// 入力 UI だけ。認証の判定はすべてサーバ(login / passkey route + proxy)で行う。
export function LoginForm({ passwordLoginEnabled }: { passwordLoginEnabled: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onPasskey() {
    setError(null);
    setSubmitting(true);
    try {
      const optRes = await fetch("/api/admin/passkey/login/options", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!optRes.ok) {
        setError(messageFor(optRes.status, "パスキーでのログインを始められませんでした。"));
        return;
      }
      const optionsJSON = await optRes.json();
      // 端末のパスキー選択ダイアログ(Face ID / Touch ID / PIN など)。
      const assertion = await startAuthentication({ optionsJSON });
      const res = await fetch("/api/admin/passkey/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(assertion),
      });
      if (res.ok) {
        goNext();
        return;
      }
      setError(messageFor(res.status, "このパスキーではログインできません。"));
    } catch {
      // ダイアログのキャンセルもここに来る。
      setError("パスキーでのログインが完了しませんでした。もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // same-origin 限定。CSRF 対策として login route 側でも Origin/Host を検証する。
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        goNext();
        return;
      }
      setError(messageFor(res.status, "パスワードが違います。"));
    } catch {
      setError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold">管理ログイン</h1>
        <p className="mt-1 text-sm text-zinc-500">運営専用ページです。</p>

        <button
          type="button"
          onClick={onPasskey}
          disabled={submitting}
          className="mt-5 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "確認中…" : "パスキーでログイン"}
        </button>

        {passwordLoginEnabled && (
          <form onSubmit={onSubmit} className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <label htmlFor="admin-password" className="block text-sm font-medium">
              パスワード
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              type="submit"
              disabled={submitting || password.length === 0}
              className="mt-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
            >
              パスワードでログイン
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
