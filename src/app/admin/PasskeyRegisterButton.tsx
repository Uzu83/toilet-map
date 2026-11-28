"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

// この端末のパスキーを登録するボタン(Issue #61)。ログイン済みのダッシュボードにだけ出す。
// 登録 API もログイン済み admin + 同一オリジンでしか受け付けない(サーバ側で再確認)。
export function PasskeyRegisterButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function register() {
    setBusy(true);
    setMessage(null);
    try {
      const optRes = await fetch("/api/admin/passkey/register/options", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!optRes.ok) {
        setMessage(optRes.status === 503 ? "パスキーの設定が未完了です" : "登録を始められませんでした");
        return;
      }
      const optionsJSON = await optRes.json();
      const attestation = await startRegistration({ optionsJSON });
      const res = await fetch("/api/admin/passkey/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(attestation),
      });
      if (res.ok) setMessage("パスキーを登録しました");
      else if (res.status === 409) setMessage("このパスキーは登録済みです");
      else setMessage("登録できませんでした");
    } catch {
      // ダイアログのキャンセル・この端末に登録済み(excludeCredentials)もここに来る。
      setMessage("登録が完了しませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-baseline gap-2">
      <button
        type="button"
        onClick={register}
        disabled={busy}
        className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {busy ? "登録中…" : "パスキーを登録"}
      </button>
      {message && (
        <span role="status" className="text-xs text-zinc-500">
          {message}
        </span>
      )}
    </span>
  );
}
