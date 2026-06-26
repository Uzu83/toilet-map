// Phase B(B1): AI 提案の「サーバ側検証 + 型強制」モジュール(server-only ではないが副作用なし純関数)。
//
// 役割: LLM(aiAnalysis.ts)が返した提案を ai_suggestions に積む前に、field/value/confidence/evidence を
//   検証し、field 別に value を「DB/RPC が期待する型」へ正規化する。LLM 出力は信頼しない(structured output は
//   「型」は強制できても「値の正しさ」は保証しない)ので、こことサーバ/DB allowlist が最終防壁。
//
// ⚠️ 設計の核(PHASE-B-DESIGN-BRIEF.md): value は LLM からは必ず z.string() で受ける
//   (field 型混在 + Google structured output が z.union 非対応のため)。bool 化はここ(サーバ側)で行う。
//   正規化後の値は ai_suggestions.value(jsonb)に入り、admin_apply_edit の p_patch と対称に解釈される。
//
// ⚠️ field allowlist は adminAuth.ts の EDITABLE_FIELDS を import 共有する(二重定義しない)。
//   ここで独自リストを持つと、将来 EDITABLE_FIELDS に列が増減したとき片方が取り残されて齟齬が出る。

import { EDITABLE_FIELDS, MAX_NAME_LEN, MAX_OPENING_HOURS_LEN, type EditableField } from "@/lib/adminAuth";
import { ACCESS_SET } from "@/types/toilet";

// 正規化済み提案。value は field の型に合わせて string | boolean になる(DB の jsonb と RPC 解釈に対称)。
//   - bool3(has_washlet / has_diaper_table / is_universal): boolean
//   - name / inferred_access / opening_hours: string
// ⚠️ null は許さない: AI 提案は「こう設定すべき」という積極的な値のみ扱う。「消す(null 化)」は手動編集の領分
//   (誤検出で値を消されると利用者影響が大きい)。null 化したいなら admin が手動 PATCH する。
export type NormalizedAiSuggestion = {
  field: EditableField;
  value: string | boolean;
  confidence: number;
  evidence: string;
};

// bool3 列(boolean に強制する 3 列)。EDITABLE_FIELDS の部分集合。
//   ここを EDITABLE_FIELDS と独立に「再定義」しているのは意図的: bool3 は「型が boolean」という固有の性質を持ち、
//   EDITABLE_FIELDS(6 列)とは粒度が違う。auto 反映の DB ガード(014)とも一致させる。
const BOOL_FIELDS = new Set<EditableField>(["has_washlet", "has_diaper_table", "is_universal"]);

// MAX_NAME_LEN / MAX_OPENING_HOURS_LEN は adminAuth.ts からインポートした単一定義を使う。
// ACCESS_SET も同様に types/toilet.ts から。局所的な再宣言は上流変更との乖離を招くため廃止した。

export class AiSuggestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSuggestionValidationError";
  }
}

// "true"/"false"/"yes"/"no"/"あり"/"なし" 等の表記ゆれを boolean に寄せる。
//   WHY ゆるめに受ける: LLM は value を文字列で返す(union 回避)ため、bool3 列でも "true" や "yes"、
//   日本語の「あり/なし」で返しうる。代表的な肯定/否定語のみ厳密にマップし、それ以外は「不明」として
//   null を返す(= 検証で弾く)。曖昧な値を勝手に true/false に倒さない(誤反映回避)。
function parseBoolLoose(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (["true", "yes", "y", "1", "あり", "ある", "有"].includes(s)) return true;
  if (["false", "no", "n", "0", "なし", "ない", "無"].includes(s)) return false;
  return null;
}

// 1 提案を検証し正規化する。不正なら AiSuggestionValidationError を throw(呼び出し側で「この提案は積まない」)。
//
// 引数は LLM 由来の生値(field/value/confidence/evidence)。value は LLM からは string で来る前提だが、
//   防御的に unknown で受けて型も確認する(将来 schema を変えても安全側で弾く)。
export function validateAiSuggestion(
  field: unknown,
  value: unknown,
  confidence: unknown,
  evidence: unknown,
): NormalizedAiSuggestion {
  // field: EDITABLE_FIELDS のいずれか(adminAuth と共有 = 二重定義しない)。
  if (typeof field !== "string" || !(EDITABLE_FIELDS as readonly string[]).includes(field)) {
    throw new AiSuggestionValidationError(`field not allowed: ${String(field)}`);
  }
  const f = field as EditableField;

  // confidence: [0,1] の有限数。範囲外/非数は弾く(auto 反映の閾値判定に使うので壊れた値を通さない)。
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new AiSuggestionValidationError("confidence must be a number in [0,1]");
  }

  // evidence: 非空文字列(反映根拠の追跡性。空だと「なぜ反映したか」が残らない)。
  if (typeof evidence !== "string" || evidence.trim().length === 0) {
    throw new AiSuggestionValidationError("evidence must be a non-empty string");
  }

  // value: field 別に型強制。LLM は string で返す前提だが boolean が来ても許容(bool3 のみ)。
  let normalized: string | boolean;

  if (BOOL_FIELDS.has(f)) {
    // bool3: boolean か、文字列ゆれを parseBoolLoose で boolean 化。不明(null)は弾く。
    if (typeof value === "boolean") {
      normalized = value;
    } else if (typeof value === "string") {
      const b = parseBoolLoose(value);
      if (b === null) {
        throw new AiSuggestionValidationError(`${f} value not boolean-like: ${value}`);
      }
      normalized = b;
    } else {
      throw new AiSuggestionValidationError(`${f} must be boolean or boolean-like string`);
    }
  } else if (f === "inferred_access") {
    // enum 文字列(open/ask/permission)。それ以外は弾く。
    if (typeof value !== "string" || !ACCESS_SET.has(value as "open" | "ask" | "permission")) {
      throw new AiSuggestionValidationError("inferred_access must be one of open/ask/permission");
    }
    normalized = value;
  } else {
    // name / opening_hours: 文字列。空文字は弾く(空にしたいなら手動編集 = null 化の領分)。長さ上限も適用。
    if (typeof value !== "string") {
      throw new AiSuggestionValidationError(`${f} must be string`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new AiSuggestionValidationError(`${f} must not be empty`);
    }
    const max = f === "name" ? MAX_NAME_LEN : MAX_OPENING_HOURS_LEN;
    if (trimmed.length > max) {
      throw new AiSuggestionValidationError(`${f} too long`);
    }
    normalized = trimmed;
  }

  return { field: f, value: normalized, confidence, evidence: evidence.trim() };
}

// 自動反映の閾値(server-only)。env AI_AUTO_APPLY_THRESHOLD(0..1)。未設定/不正なら既定 0.85。
//   ───────────────────────────────────────────────────────────────────
//   なぜ 0.85 か(オーナー決定 2026-06-21):
//     - 低すぎる(例 0.5): LLM の曖昧な推測まで自動反映され、誤反映が利用者に露出する。
//     - 高すぎる(例 0.99): ほぼ何も自動反映されず、自動化の便益が出ない(全部 manual キューに落ちる)。
//     - 0.85 ≒ 「LLM が明確な根拠を持って高確信のものだけ自動反映」の妥協点。env なので再デプロイ無しで調整可。
//   ⚠️ server-only(NEXT_PUBLIC 禁止): 閾値はモデレーションの内部パラメータ。クライアントに露出しない。
//   ⚠️ B1 ではこの値は使われない(自動反映 auto は B2)。isAutoApplyEligible のためにここで一元化しておく。
export function getAutoApplyThreshold(): number {
  const raw = process.env.AI_AUTO_APPLY_THRESHOLD ?? "0.85";
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0.85;
  return n;
}

// 自動反映の適格判定(B1 では呼ばない・B2 の ai_apply_suggestion(auto) 前段で使う想定)。
//   条件(014 の DB ガード High③ と一致させる + evidence の原文照合をアプリ層で追加):
//     ① bool3 列(has_washlet / has_diaper_table / is_universal)
//     ② value が boolean
//     ③ confidence >= 閾値
//     ④ evidence が元コメントの「部分文字列」(要約/翻訳された evidence は manual キューのみ。追跡性が安全性に直結)
//   ⚠️ DB(014)でも ①②③ を二重ガードする(env 改変や呼び出しミスで access が auto 反映されないため)。
//      ④(原文照合)はアプリ層のみ: 元コメント文字列が DB ガードからは見えない(value/confidence しか持たない)。
//   WHY 関数を B1 で用意だけする: B2 で「どの提案を auto に回すか」を一貫した基準で判定するため、
//      基準を 1 箇所(ここ)に固定しておく。B1 では import されず未使用でも、規約として置く。
export function isAutoApplyEligible(
  suggestion: NormalizedAiSuggestion,
  sourceComment: string,
  threshold: number = getAutoApplyThreshold(),
): boolean {
  if (!BOOL_FIELDS.has(suggestion.field)) return false;
  if (typeof suggestion.value !== "boolean") return false;
  if (suggestion.confidence < threshold) return false;
  // evidence は元コメントの部分文字列であること(大文字小文字を無視して照合)。
  //   要約/翻訳されて原文に無い evidence は false(= manual キュー行きにする)。
  if (!sourceComment.toLowerCase().includes(suggestion.evidence.toLowerCase())) return false;
  return true;
}
