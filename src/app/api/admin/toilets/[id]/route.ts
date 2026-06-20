import { NextResponse, type NextRequest } from "next/server";
import {
  AdminEditValidationError,
  isSameOrigin,
  validateEdit,
} from "@/lib/adminAuth";
import { noStore } from "@/lib/adminHttp";
import { getAdminSession } from "@/lib/adminSession";
import { getServerSupabaseSecret } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

// secret(SUPABASE_SECRET_KEY / ADMIN_SESSION_SECRET)を読むため Node ランタイム固定。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ───────────────────────────────────────────────────────────────────
// このルートは「アトミック RPC を呼ぶだけ」の薄いラッパに保つ(Codex 異モデルレビュー critical+high 対応)
// ───────────────────────────────────────────────────────────────────
// ⚠️⚠️ 後任 AI への警告: 編集/取消を「アプリ層の read-modify-write(SELECT→UPDATE→admin_edits INSERT)」に
//    戻さないこと。それらを別クエリに割ると、SELECT と UPDATE の間に別 PATCH が割り込む TOCTOU(lost update)、
//    UPDATE 成功 + 監査 INSERT 失敗による「監査なしの変更」、undo の check→update の窓、が再導入される。
//    編集と監査は必ず同一トランザクション = 012 の admin_apply_edit / admin_undo_edit(plpgsql RPC, FOR UPDATE)
//    に閉じる。本ルートは「認証/CSRF/入力検証 → RPC 呼び出し → RPC の結果/エラーを HTTP に写す」だけを担う。
//
// 二層防御の役割分担:
//   - アプリ層 validateEdit(adminAuth.ts): 未知キー/source/型違反を「早期に 400 で拒否」(UX とログの明瞭さ)。
//   - DB 層 admin_apply_edit(012): 列ホワイトリストを再固定し、別経路から呼ばれても改ざんを「最終遮断」。
//   両者は冗長だが意図的(多層防御)。片方を消さない。
//
// ⚠️⚠️ guard(Codex R2[medium]・監査の一貫性): このルートから toilets への書き込みは「必ず」
//    admin_apply_edit / admin_undo_edit RPC 経由で行うこと。getServerSupabaseSecret() は service_role
//    (= 001:119 で toilets の直接 UPDATE 権限を持つ)を返すので、supabase.from("toilets").update(...) を
//    直接書くことは技術的には可能だが、それをやると admin_edits への before/after 監査が残らず、
//    「監査必須」の一貫性が破れる(= 監査なしの admin 変更)。
//    service_role の広域 UPDATE 権限を revoke しない理由は 012 冒頭の決定参照(seed-osm の osm_id upsert =
//    INSERT…ON CONFLICT DO UPDATE が 001:119 の grant に依存するため revoke できない=規律で担保)。
//    後任 AI へ: ここで .from("toilets").update() / .delete() を直接書かない。常に監査 RPC を呼ぶこと。

// RPC のエラーメッセージは 012 で 'admin_rpc: <理由>' 形式に固定してある。route はこの理由を見て
// HTTP ステータスを出し分ける(生 DB メッセージはクライアントに返さない=内部スキーマ非露出)。
// マッピングを 1 箇所に集約し、未知の理由は 500 にフォールバックする(フェイルセーフ)。
function statusForRpcError(message: string): number {
  if (message.includes("toilet not found")) return 404;
  if (message.includes("no edit to undo")) return 404;
  if (message.includes("edit is not latest")) return 409;
  if (message.includes("current value drifted")) return 409;
  if (message.includes("invalid inferred_access")) return 400;
  // invalid editor 等(呼び出し側のバグ)・想定外は 500。
  return 500;
}

// クライアントに返す安全な文言(生 DB 文言は出さない)。理由コードだけを露出する。
function clientErrorFor(status: number): string {
  switch (status) {
    case 404:
      return "not found";
    case 409:
      return "conflict: newer state exists";
    case 400:
      return "invalid value";
    default:
      return "internal error";
  }
}

// 共通の前段ガード: ①認証 cookie 再検証 ②CSRF(同一オリジン)③id が uuid。
// 通れば id を返す。失敗時は NextResponse(エラー)を返す。
async function guard(
  request: NextRequest,
  rawId: string,
): Promise<{ ok: true; id: string } | { ok: false; res: NextResponse }> {
  // ① 認証 cookie 再検証(proxy をすり抜けてもここで止める = 権限の最終根拠)。
  const session = await getAdminSession();
  if (!session) {
    return { ok: false, res: noStore(NextResponse.json({ error: "unauthorized" }, { status: 401 })) };
  }
  // ② CSRF: cookie 認証の変更系なので、自サイト由来かを Origin/Host で確認する(SameSite=Lax と併用)。
  if (!isSameOrigin(request)) {
    return { ok: false, res: noStore(NextResponse.json({ error: "bad origin" }, { status: 403 })) };
  }
  // ③ パスの id が uuid 形か(不正値で DB に投げない)。
  if (!isUuid(rawId)) {
    return { ok: false, res: noStore(NextResponse.json({ error: "invalid id" }, { status: 400 })) };
  }
  return { ok: true, id: rawId };
}

// admin_apply_edit / admin_undo_edit の戻り値(jsonb)を受ける最小 shape。
// supabase-js は RPC 戻り値を静的解析できないので unknown 経由で受け直す。
type ApplyEditResult = { applied?: boolean; edit_id?: string | null; changed_fields?: string[] };
type UndoEditResult = { restored?: string[]; undo_edit_id?: string | null };

// PATCH /api/admin/toilets/[id] — allowlist フィールドのみ UPDATE + admin_edits に before/after 追記。
//
// 手順: ①認証 ②CSRF ③validateEdit(アプリ層 allowlist) ④admin_apply_edit RPC(DB 側でアトミックに
//   FOR UPDATE → allowlist 再固定 → 変化列のみ UPDATE + 監査 INSERT を単一トランザクションで)。
//   旧実装の read-modify-write(before 取得→update→audit 別クエリ)は撤去済み。
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const g = await guard(request, rawId);
  if (!g.ok) return g.res;
  const id = g.id;

  // ボディ(JSON)→ allowlist 検証。未知キー・source・型違反はここで弾かれる(throw)。
  // これは「早期拒否」層。DB 層の admin_apply_edit も同じ列ホワイトリストを持つ(多層防御)。
  let patch: ReturnType<typeof validateEdit>;
  try {
    const body = (await request.json()) as unknown;
    patch = validateEdit(body);
  } catch (err) {
    if (err instanceof AdminEditValidationError) {
      // AdminEditValidationError はアプリ定義の安全なメッセージ(列名 allowlist 違反等)なのでそのまま返す。
      return noStore(NextResponse.json({ error: err.message }, { status: 400 }));
    }
    return noStore(NextResponse.json({ error: "invalid json" }, { status: 400 }));
  }

  try {
    const supabase = getServerSupabaseSecret();

    // ④ アトミック編集 RPC。編集(変化列の UPDATE)+ 監査(admin_edits INSERT)を単一トランザクションで実行。
    //   どちらか失敗で全ロールバック → 「監査なしの変更」が構造的に起こらない。並行 PATCH は FOR UPDATE で直列化。
    const { data, error } = await supabase.rpc("admin_apply_edit", {
      p_toilet_id: id,
      p_editor: "admin", // Phase A は手動編集のみ(AI は Phase B で 'ai' を渡す)。
      p_patch: patch as Record<string, unknown>,
    });

    if (error) {
      // RPC が raise した理由を 'admin_rpc: ...' から判別して HTTP に写す。生 DB 文言は返さない。
      const status = statusForRpcError(error.message);
      if (status === 500) {
        // 想定外/内部バグはサーバログに残す(クライアントには generic のみ)。
        console.error("[api/admin/toilets] apply_edit rpc error", error);
      }
      return noStore(NextResponse.json({ error: clientErrorFor(status) }, { status }));
    }

    const result = (data ?? {}) as ApplyEditResult;
    // applied=false は no-op(現状と同値)。冪等に 200 + changed:[] を返す。
    return noStore(
      NextResponse.json({ ok: true, changed: result.changed_fields ?? [] }),
    );
  } catch (err) {
    // 例外の生メッセージはクライアントに返さない(内部情報の露出防止)。詳細はサーバログのみ。
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[api/admin/toilets] unexpected error", message);
    return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
  }
}

// DELETE /api/admin/toilets/[id]?editId=<uuid> — 直近の編集を「取消」する。
//
// 取消ポリシー(設計書 R1#5): 古い edit を無条件に before へ戻すと後続編集まで巻き戻す。
//   よって admin_undo_edit(012)が DB 側で「最新 edit かつ 現在値==after」の不変条件を FOR UPDATE 下で検証し、
//   満たすときだけ before へ復元 + 取消も admin_edits に追記する(append-only)。検証と適用は同一トランザクション。
//
// editId: クライアントが「取消したい edit」の id。最新でなければ RPC が 409 を返す。
//   ⚠️ editId 必須にする WHY: 「最新を何でも取消」だと、画面表示後に別編集が入っていた場合に
//     ユーザの意図と違う edit を取消してしまう。クライアントが見ている edit を明示させ、ズレを 409 で弾く。
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const g = await guard(request, rawId);
  if (!g.ok) return g.res;
  const id = g.id;

  // 取消対象 edit の id(query param)。uuid 形でなければ 400。
  const editId = request.nextUrl.searchParams.get("editId");
  if (!editId || !isUuid(editId)) {
    return noStore(NextResponse.json({ error: "editId required" }, { status: 400 }));
  }

  try {
    const supabase = getServerSupabaseSecret();

    // アトミック取消 RPC。FOR UPDATE 下で「最新 edit か」「現在値==after か」を検証し、満たすときだけ
    //   before へ復元 + 取消監査 INSERT を同一トランザクションで。最新でない/drift は RPC が 409 を raise。
    const { data, error } = await supabase.rpc("admin_undo_edit", {
      p_toilet_id: id,
      p_edit_id: editId,
    });

    if (error) {
      const status = statusForRpcError(error.message);
      if (status === 500) {
        console.error("[api/admin/toilets] undo_edit rpc error", error);
      }
      return noStore(NextResponse.json({ error: clientErrorFor(status) }, { status }));
    }

    const result = (data ?? {}) as UndoEditResult;
    return noStore(NextResponse.json({ ok: true, restored: result.restored ?? [] }));
  } catch (err) {
    // 例外の生メッセージはクライアントに返さない(内部情報の露出防止)。詳細はサーバログのみ。
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[api/admin/toilets] unexpected undo error", message);
    return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
  }
}
