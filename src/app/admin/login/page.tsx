"use client";

import { useState, type FormEvent } from "react";

// 管理サブツリー全体で静的化しない方針を統一する(他の admin route/page と揃える)。
// WHY login だけ明示が要る: page セグメントの dynamic は親 layout から継承されないため、ここにも書く。
//   秘密値は含まない純粋な入力 UI だが、「管理 HTML を static 生成しない」という設計の一貫性を保ち、
//   将来この page にサーバ条件分岐(既ログイン時 /admin へ誘導等)を足したときの静的化バグを防ぐ。
export const dynamic = "force-dynamic";

// /admin/login — 運営専用ログイン(日本語のみ・簡素)。
// パスワードを POST /api/admin/login に送り、成功したら署名 cookie が Set-Cookie され /admin へ進む。
// WHY Client component: フォーム送信・エラー表示の小さなインタラクションのため。
//   認証の判定はすべてサーバ(login route + proxy)で行い、ここは入力 UI に徹する。
export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        // ログイン後の遷移先。?next= があればそこへ(proxy が付与)、無ければ /admin。
        const params = new URLSearchParams(window.location.search);
        const next = params.get("next");
        // オープンリダイレクト防止: 自サイト内の絶対パス(/admin 配下)に限定する。
        const dest = next && next.startsWith("/admin") ? next : "/admin";
        window.location.assign(dest);
        return;
      }

      if (res.status === 429) {
        setError("試行回数が多すぎます。しばらく待って再度お試しください。");
      } else if (res.status === 503) {
        setError("サーバー側の設定が未完了です。管理者に連絡してください。");
      } else {
        setError("パスワードが違います。");
      }
    } catch {
      setError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h1 className="text-lg font-semibold">管理ログイン</h1>
        <p className="mt-1 text-sm text-zinc-500">運営専用ページです。</p>

        <label htmlFor="admin-password" className="mt-5 block text-sm font-medium">
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

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || password.length === 0}
          className="mt-5 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "確認中…" : "ログイン"}
        </button>
      </form>
    </main>
  );
}
