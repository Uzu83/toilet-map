"use client";

import { useState } from "react";
import type { EditableField } from "@/lib/adminAuth";

// /admin ダッシュボードのクライアント部分(編集フォーム・取消ボタンのインタラクション)。
// 認証・検証・DB 書き込みはすべてサーバ(page.tsx + API ルート)。ここは入力 UI とリフレッシュに徹する。
// 日本語のみ(運営専用ページ・i18n 不要 / 設計書の決定事項)。

export type AdminReview = {
  id: string;
  toiletId: string;
  rating: number;
  accessLevel: string;
  hasWashlet: boolean | null;
  comment: string;
  notAToilet: boolean;
  createdAt: string;
};

export type AdminToilet = {
  id: string;
  source: string;
  name: string | null;
  inferred_access: "open" | "ask" | "permission" | null;
  has_washlet: boolean | null;
  has_diaper_table: boolean | null;
  is_universal: boolean | null;
  opening_hours: string | null;
};

export type AdminEditLog = {
  id: string;
  toiletId: string;
  editor: string;
  changedFields: EditableField[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
};

const ACCESS_LABEL: Record<string, string> = {
  open: "声かけ不要(青)",
  ask: "一声かける(黄)",
  permission: "許可必要(赤)",
};

// boolean | null の 3 値を <select> で扱うためのコード化(空文字=不明=null)。
function boolToCode(v: boolean | null): string {
  if (v === true) return "true";
  if (v === false) return "false";
  return "";
}
function codeToBool(code: string): boolean | null {
  if (code === "true") return true;
  if (code === "false") return false;
  return null;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function AdminDashboard({
  reviews,
  toilets,
  edits,
}: {
  reviews: AdminReview[];
  toilets: Record<string, AdminToilet>;
  edits: AdminEditLog[];
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">管理ダッシュボード</h1>
        <div className="flex items-baseline gap-3">
          <span className="text-xs text-zinc-500">運営専用・日本語のみ</span>
          <LogoutButton />
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          コメント付きレビュー({reviews.length})
        </h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-zinc-500">コメント付きのレビューはまだありません。</p>
        ) : (
          <ul className="space-y-4">
            {reviews.map((r) => (
              <ReviewCard key={r.id} review={r} toilet={toilets[r.toiletId]} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          直近の編集履歴({edits.length})
        </h2>
        {edits.length === 0 ? (
          <p className="text-sm text-zinc-500">編集履歴はまだありません。</p>
        ) : (
          <ul className="space-y-2">
            {edits.map((e, i) => (
              // 取消は「そのトイレの最新 edit のみ」サーバ(admin_undo_edit)が許可する。UI でも最新
              // (各トイレの先頭)だけボタンを出す。edits は page.tsx で edit_seq desc(挿入順の最新が先頭)
              // に並ぶので、同トイレが先に現れた行が最新。順序の根拠が DB の undo 判定と同じ edit_seq なので
              // 「UI で最新に見える行」と「DB が取消を許す行」が一致する(created_at 順だとズレうる)。
              <EditLogRow
                key={e.id}
                edit={e}
                isLatestForToilet={edits.findIndex((x) => x.toiletId === e.toiletId) === i}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

// この端末のセッションを終わらせるログアウトボタン。
// WHY 個別ログアウトを置く: 失効手段が secret ローテーション(全セッション一括失効=運用者も巻き込む)しか無いと、
//   共有端末・端末紛失時に「この端末のセッションだけ穏当に終わらせる」ことができない。
//   cookie は httpOnly なのでサーバ(POST /api/admin/logout)に削除を依頼する。
function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "same-origin", // cookie を送る。CSRF はサーバの Origin/Host 検証で守る
      });
      // 成否に関わらずログイン画面へ。成功なら cookie は消えており、未認証として扱われる。
      if (res.ok) {
        window.location.assign("/admin/login");
        return;
      }
    } catch {
      // ネットワーク失敗時は何もしない(ボタンを再度押せる状態に戻す)。
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {busy ? "ログアウト中…" : "ログアウト"}
    </button>
  );
}

function ReviewCard({ review, toilet }: { review: AdminReview; toilet: AdminToilet | undefined }) {
  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span>★{review.rating}</span>
        <span>{ACCESS_LABEL[review.accessLevel] ?? review.accessLevel}</span>
        {review.notAToilet && <span className="text-red-600">「ここトイレない」報告</span>}
        <span className="ml-auto">{fmtDate(review.createdAt)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{review.comment}</p>

      {toilet ? (
        <ToiletEditForm toilet={toilet} />
      ) : (
        <p className="mt-3 text-xs text-zinc-500">
          紐づくトイレが見つかりません(削除済みの可能性)。
        </p>
      )}
    </li>
  );
}

// allowlist フィールドの編集フォーム。保存で PATCH /api/admin/toilets/[id]。
function ToiletEditForm({ toilet }: { toilet: AdminToilet }) {
  const [name, setName] = useState(toilet.name ?? "");
  const [inferredAccess, setInferredAccess] = useState<string>(toilet.inferred_access ?? "");
  const [hasWashlet, setHasWashlet] = useState(boolToCode(toilet.has_washlet));
  const [hasDiaper, setHasDiaper] = useState(boolToCode(toilet.has_diaper_table));
  const [isUniversal, setIsUniversal] = useState(boolToCode(toilet.is_universal));
  const [openingHours, setOpeningHours] = useState(toilet.opening_hours ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setStatus(null);
    setSaving(true);
    try {
      // 送るのは allowlist 列のみ。inferred_access は enum 必須なので空("")のときは送らない
      //   (サーバ側で null を弾く設計のため、未選択は「変更しない」を意味する)。
      const patch: Record<string, unknown> = {
        name: name === "" ? null : name,
        has_washlet: codeToBool(hasWashlet),
        has_diaper_table: codeToBool(hasDiaper),
        is_universal: codeToBool(isUniversal),
        opening_hours: openingHours === "" ? null : openingHours,
      };
      if (inferredAccess !== "") patch.inferred_access = inferredAccess;

      const res = await fetch(`/api/admin/toilets/${toilet.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin", // cookie を送る。CSRF はサーバの Origin/Host 検証で守る
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const j = (await res.json()) as { changed?: string[] };
        setStatus(
          j.changed && j.changed.length > 0
            ? `保存しました(${j.changed.join(", ")})`
            : "変更はありませんでした",
        );
        // 監査履歴・最新状態を反映するためリロード(SPA 内差分更新は Phase A では作らない)。
        if (j.changed && j.changed.length > 0) {
          setTimeout(() => window.location.reload(), 600);
        }
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus(`エラー: ${j.error ?? res.status}`);
      }
    } catch {
      setStatus("通信に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-2 text-xs text-zinc-500">
        トイレ編集(source: {toilet.source})
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs">
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="text-xs">
          推定アクセス
          <select
            value={inferredAccess}
            onChange={(e) => setInferredAccess(e.target.value)}
            className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">(変更しない)</option>
            <option value="open">{ACCESS_LABEL.open}</option>
            <option value="ask">{ACCESS_LABEL.ask}</option>
            <option value="permission">{ACCESS_LABEL.permission}</option>
          </select>
        </label>
        <label className="text-xs">
          ウォシュレット
          <TriSelect value={hasWashlet} onChange={setHasWashlet} />
        </label>
        <label className="text-xs">
          おむつ交換台
          <TriSelect value={hasDiaper} onChange={setHasDiaper} />
        </label>
        <label className="text-xs">
          多目的トイレ
          <TriSelect value={isUniversal} onChange={setIsUniversal} />
        </label>
        <label className="text-xs">
          営業時間(OSM 形式)
          <input
            value={openingHours}
            onChange={(e) => setOpeningHours(e.target.value)}
            maxLength={200}
            placeholder="例: 24/7, Mo-Su 09:00-21:00"
            className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存"}
        </button>
        {status && <span className="text-xs text-zinc-600 dark:text-zinc-400">{status}</span>}
      </div>
    </div>
  );
}

// boolean | null(不明/あり/なし)の 3 値 select。
function TriSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
    >
      <option value="">不明</option>
      <option value="true">あり</option>
      <option value="false">なし</option>
    </select>
  );
}

function EditLogRow({
  edit,
  isLatestForToilet,
}: {
  edit: AdminEditLog;
  isLatestForToilet: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);

  async function undo() {
    setStatus(null);
    setUndoing(true);
    try {
      // editId を明示送付する。サーバ側(admin_undo_edit RPC)は「この edit が最新かつ
      // 現在値==after」を FOR UPDATE 下で検証し、ズレていれば 409 を返す(後続編集の巻き戻し防止)。
      const res = await fetch(
        `/api/admin/toilets/${edit.toiletId}?editId=${encodeURIComponent(edit.id)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        },
      );
      if (res.ok) {
        setStatus("取消しました");
        setTimeout(() => window.location.reload(), 600);
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        // 409 = 後続編集があり取消不可。利用者に理由を伝える。
        setStatus(res.status === 409 ? "後続の編集があるため取消できません" : `エラー: ${j.error ?? res.status}`);
      }
    } catch {
      setStatus("通信に失敗しました");
    } finally {
      setUndoing(false);
    }
  }

  return (
    <li className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{edit.editor}</span>
        <span className="text-zinc-600 dark:text-zinc-400">{edit.changedFields.join(", ")}</span>
        <span className="ml-auto text-zinc-500">{fmtDate(edit.createdAt)}</span>
      </div>
      <div className="mt-1 text-zinc-500">
        {edit.changedFields.map((f) => (
          <div key={f}>
            <span className="font-medium">{f}</span>: {JSON.stringify(edit.before[f])} →{" "}
            {JSON.stringify(edit.after[f])}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        {isLatestForToilet && (
          <button
            type="button"
            onClick={undo}
            disabled={undoing}
            className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {undoing ? "取消中…" : "この編集を取消"}
          </button>
        )}
        {status && <span className="text-zinc-600 dark:text-zinc-400">{status}</span>}
      </div>
    </li>
  );
}
