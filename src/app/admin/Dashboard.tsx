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

// AI 提案キューの 1 行(status='pending')。approve は id を送るだけ(値はサーバ ai_suggestions が真実)。
export type AdminSuggestion = {
  id: string;
  toiletId: string;
  reviewId: string | null;
  field: EditableField;
  value: string | boolean | null; // jsonb(string | boolean)。表示専用。
  confidence: number | null;
  evidence: string | null;
  createdAt: string;
};

const ACCESS_LABEL: Record<string, string> = {
  open: "声かけ不要(青)",
  ask: "一声かける(黄)",
  permission: "許可必要(赤)",
};

// 編集可能フィールドの日本語ラベル(AI提案キューの表示用)。EDITABLE_FIELDS と同じ 6 列。
const FIELD_LABEL: Record<EditableField, string> = {
  name: "名称",
  inferred_access: "推定アクセス",
  has_washlet: "ウォシュレット",
  has_diaper_table: "おむつ交換台",
  is_universal: "多目的トイレ",
  opening_hours: "営業時間",
};

// AI提案の値 / トイレ現在値を人間が読める文字列にする(表示専用)。
//   boolean → あり/なし、null/undefined → 不明、inferred_access の enum → 日本語ラベル、その他 → そのまま。
function fmtFieldValue(field: EditableField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "不明";
  if (typeof value === "boolean") return value ? "あり" : "なし";
  if (field === "inferred_access" && typeof value === "string") {
    return ACCESS_LABEL[value] ?? value;
  }
  return String(value);
}

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
  suggestions,
}: {
  reviews: AdminReview[];
  toilets: Record<string, AdminToilet>;
  edits: AdminEditLog[];
  suggestions: AdminSuggestion[];
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

      {/* AI 提案キュー(B1: 手動 approve/reject のみ・自動反映なし)。pending を上部に置き、運営が先に捌けるように。 */}
      <section>
        <h2 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          AI提案キュー({suggestions.length}件 / pending)
        </h2>
        <p className="mb-3 text-xs text-zinc-500">
          レビューを「AI分析」すると提案がここに溜まります。承認で反映(監査に記録)、却下で破棄します。
          自動反映はありません(全件あなたの承認が必要)。
        </p>
        {suggestions.length === 0 ? (
          <p className="text-sm text-zinc-500">未処理の提案はありません。</p>
        ) : (
          <ul className="space-y-3">
            {suggestions.map((s) => (
              <SuggestionCard key={s.id} suggestion={s} toilet={toilets[s.toiletId]} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
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
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "same-origin", // cookie を送る。CSRF はサーバの Origin/Host 検証で守る
      });
      // #25 — 非 OK(403/500 等)でも無条件でログイン画面に遷移する。
      //   理由: cookie 削除は冪等(サーバがエラーを返しても Set-Cookie: 削除済みか、
      //   そもそも cookie が既に無効になっているケースが多い)。
      //   成功時のみ遷移する旧実装だと 403/500 でユーザーがログイン画面に戻れず
      //   「ログアウトできない」状態に陥る。遷移後も認証 cookie が残っていれば
      //   次の admin アクセスで再認証を求められるので、セキュリティ上の後退はない。
      window.location.assign("/admin/login");
    } catch {
      // ネットワーク失敗時(DNS 解決不可・fetch 例外)のみ遷移をスキップし、
      // ユーザーがリトライできるようボタンを戻す。
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
        {/* not_a_toilet は「情報フラグ」表示のみ(編集可能カラムではない=AI 提案の適用対象に含めない)。 */}
        {review.notAToilet && <span className="text-red-600">「ここトイレない」報告</span>}
        <span className="ml-auto">{fmtDate(review.createdAt)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{review.comment}</p>

      {/* AI 分析ボタン: このコメントを Gemini で分析し、提案を AI提案キューに pending で積む(B1)。 */}
      <AnalyzeButton reviewId={review.id} />

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

// レビュー 1 件を AI 分析するボタン。POST /api/admin/analyze に review_id を送る。
//   ⚠️ 二重送信防止: クリック後 busy で disabled。Gemini 無料枠は RPM が低い + 1 コメント=1 リクエストなので
//     連打で無駄なリクエストを飛ばさない(busy 中はボタンを押せない)。
//   結果は提案キューに溜まる → 反映を見るためページをリロードする(SPA 差分更新は B1 では作らない=過剰実装回避)。
function AnalyzeButton({ reviewId }: { reviewId: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function analyze() {
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin", // cookie を送る。CSRF はサーバの Origin/Host 検証で守る
        body: JSON.stringify({ review_id: reviewId }),
      });
      if (res.ok) {
        const j = (await res.json()) as {
          inserted?: number;
          skipped?: number;
          rejected?: number;
        };
        const ins = j.inserted ?? 0;
        if (ins > 0) {
          setStatus(`${ins}件をキューに追加しました`);
          // 提案キューに反映するためリロード(下部の「AI提案キュー」に出す)。
          setTimeout(() => window.location.reload(), 700);
        } else {
          // 0 件: 既存 pending と重複(skipped)か、抽出なし/検証で全部弾いた(rejected)。
          setStatus(
            (j.skipped ?? 0) > 0
              ? "新しい提案はありません(既にキューにあります)"
              : "提案は得られませんでした",
          );
        }
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        // 503 = キー未設定(no_api_key)/ 502 = LLM エラー。失敗時は何も積まれていない(再試行可)。
        setStatus(
          res.status === 503
            ? "AI 機能が未設定です"
            : `分析に失敗しました(${j.reason ?? res.status})`,
        );
      }
    } catch {
      setStatus("通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        type="button"
        onClick={analyze}
        disabled={busy}
        className="rounded border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
      >
        {busy ? "分析中…" : "AI分析"}
      </button>
      {status && <span className="text-xs text-zinc-600 dark:text-zinc-400">{status}</span>}
    </div>
  );
}

// AI提案キューの 1 件(承認/却下)。
//   承認 = POST /api/admin/suggestions/[id]{action:approve} → ai_apply_suggestion(manual) で toilets 反映 + 監査。
//   却下 = {action:reject} → ai_suggestions.status='rejected'(toilets は触らない)。
//   ⚠️ 二重送信防止: busy 中はボタン disabled。処理後リロードでキューから消える。
function SuggestionCard({
  suggestion,
  toilet,
}: {
  suggestion: AdminSuggestion;
  toilet: AdminToilet | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // トイレの現在値(提案 field に対応)。「現在値 → 提案値」を運営に見せて誤反映を防ぐ。
  const currentValue = toilet ? (toilet[suggestion.field] as unknown) : undefined;

  async function act(action: "approve" | "reject") {
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/suggestions/${suggestion.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const j = (await res.json()) as { applied?: boolean; status?: string };
        if (action === "approve") {
          // applied=false は no-op(現在値と同値)。RPC 側で no_op に終端化済み。
          setStatus(j.applied === false ? "変更不要でした(同値)" : "反映しました");
        } else {
          setStatus("却下しました");
        }
        // どちらもキューから消える(approve→反映/no_op、reject→rejected)のでリロード。
        setTimeout(() => window.location.reload(), 700);
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        // 409 = 既に処理済(他タブ/二重操作)。
        setStatus(res.status === 409 ? "すでに処理済みです" : `エラー: ${j.error ?? res.status}`);
      }
    } catch {
      setStatus("通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
          {FIELD_LABEL[suggestion.field]}
        </span>
        <span className="text-zinc-600 dark:text-zinc-400">
          {fmtFieldValue(suggestion.field, currentValue)} →{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {fmtFieldValue(suggestion.field, suggestion.value)}
          </span>
        </span>
        {suggestion.confidence !== null && (
          <span className="text-zinc-500">確信度 {Math.round(suggestion.confidence * 100)}%</span>
        )}
        <span className="ml-auto text-zinc-400">{fmtDate(suggestion.createdAt)}</span>
      </div>
      {suggestion.evidence && (
        <p className="mt-1.5 text-xs text-zinc-500">
          根拠: <span className="italic">「{suggestion.evidence}」</span>
        </p>
      )}
      {!toilet && (
        <p className="mt-1 text-xs text-amber-600">
          紐づくトイレが見つかりません(現在値を表示できません)。
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => act("approve")}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? "処理中…" : "承認して反映"}
        </button>
        <button
          type="button"
          onClick={() => act("reject")}
          disabled={busy}
          className="rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          却下
        </button>
        {status && <span className="text-xs text-zinc-600 dark:text-zinc-400">{status}</span>}
      </div>
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
