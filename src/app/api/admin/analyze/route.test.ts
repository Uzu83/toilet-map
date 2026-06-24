import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAdminSessionMock } from "../__tests__/helpers";

// ───────────────────────────────────────────────────────────────────
// テストの射程(app 層のみ)
// ───────────────────────────────────────────────────────────────────
// POST /api/admin/analyze は「guard → review 取得 → 既分析スキップ(Fix B)→ LLM → 検証通過分のみ INSERT」
// の薄いオーケストレーション。ここで検証できるのは:
//   ①認証 / CSRF / review_id バリデーション(401/403/400)
//   ②既分析 review は LLM を呼ばず skip(Fix B の冪等)
//   ③LLM 出力に注入が混じっても validateAiSuggestion を通った提案だけ INSERT される
// ⚠️ 実際の Gemini 呼び出し(aiAnalysis.analyzeComment)と plpgsql は範囲外(モック / live smoke 専管)。
//   既存 admin route テスト(toilets/[id]/route.test.ts)のモック流儀(adminSession / supabase secret /
//   origin・host ヘッダ)に倣う。

// WHY インラインファクトリ: vitest は vi.mock() をホイストするため外部 factory 関数は初期化前参照エラーになる。
vi.mock("@/lib/adminSession", () => ({
  getAdminSession: () => getAdminSessionMock(),
}));

// analyzeComment(LLM)をモック。呼ばれた回数 + 返す AnalyzeResult を差し替える。
const analyzeCommentMock = vi.fn();
vi.mock("@/lib/aiAnalysis", () => ({
  analyzeComment: (comment: string) => analyzeCommentMock(comment),
}));

// ── Supabase secret client モック ───────────────────────────────────
// テーブル別に振る舞いを変える chainable builder。差し替え可能な状態:
//   reviewRow       : reviews 取得結果(maybeSingle の data)。null で 404。
//   reviewError     : reviews 取得エラー(あれば 500)。
//   existingRow     : ai_suggestions 既分析チェックの maybeSingle 結果(Fix B)。null=未分析。
//   existingError   : 既分析チェックのエラー。
//   insertedRows    : insert に渡された payload(検証通過分のみ来る)。
//   insertError     : insert 時に返すエラー(code 付き)。
let reviewRow: Record<string, unknown> | null;
let reviewError: { message: string } | null;
let existingRow: Record<string, unknown> | null;
let existingError: { code?: string; message: string } | null;
let insertedRows: Array<Record<string, unknown>>;
let insertError: { code?: string; message: string } | null;

function makeSupabase() {
  return {
    from(table: string) {
      if (table === "reviews") {
        // .select(...).eq("id", id).maybeSingle()
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () => Promise.resolve({ data: reviewRow, error: reviewError }),
                };
              },
            };
          },
        };
      }
      if (table === "ai_suggestions") {
        return {
          // 既分析チェック: .select("id").eq("review_id", id).limit(1).maybeSingle()
          select() {
            return {
              eq() {
                return {
                  limit() {
                    return {
                      maybeSingle: () =>
                        Promise.resolve({ data: existingRow, error: existingError }),
                    };
                  },
                };
              },
            };
          },
          // 提案 INSERT。検証通過分のみ呼ばれる。
          insert(payload: Record<string, unknown>) {
            insertedRows.push(payload);
            return Promise.resolve({ error: insertError });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseSecret: () => makeSupabase(),
}));

import { POST } from "./route";

const REVIEW_ID = "33333333-3333-3333-3333-333333333333";
const TOILET_ID = "11111111-1111-1111-1111-111111111111";

function req(body: unknown, sameOrigin = true) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  headers.host = "loomap.test";
  headers.origin = sameOrigin ? "https://loomap.test" : "https://evil.test";
  return new NextRequest("https://loomap.test/api/admin/analyze", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  reviewRow = { id: REVIEW_ID, toilet_id: TOILET_ID, comment: "ウォシュレット付きで綺麗" };
  reviewError = null;
  existingRow = null; // 既定: 未分析
  existingError = null;
  insertedRows = [];
  insertError = null;
  getAdminSessionMock.mockReturnValue({ exp: 9_999_999_999, role: "admin" });
  // 既定の LLM 応答: bool3 の妥当な提案 1 件。
  analyzeCommentMock.mockResolvedValue({
    ok: true,
    suggestions: [
      { field: "has_washlet", value: "true", confidence: 0.95, evidence: "ウォシュレット付き" },
    ],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/analyze — guard", () => {
  it("未認証 → 401(LLM を呼ばない)", async () => {
    getAdminSessionMock.mockReturnValue(null);
    const res = await POST(req({ review_id: REVIEW_ID }));
    expect(res.status).toBe(401);
    expect(analyzeCommentMock).not.toHaveBeenCalled();
  });

  it("CSRF(別オリジン)→ 403(LLM を呼ばない)", async () => {
    const res = await POST(req({ review_id: REVIEW_ID }, false));
    expect(res.status).toBe(403);
    expect(analyzeCommentMock).not.toHaveBeenCalled();
  });

  it("review_id が uuid でない → 400(LLM を呼ばない)", async () => {
    const res = await POST(req({ review_id: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(analyzeCommentMock).not.toHaveBeenCalled();
  });

  it("review_id 欠落 → 400", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(analyzeCommentMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/analyze — Fix B 冪等(既分析スキップ)", () => {
  it("ai_suggestions に既存行があれば LLM を呼ばず skipped を返す", async () => {
    existingRow = { id: "existing-sugg-id" };
    const res = await POST(req({ review_id: REVIEW_ID }));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; skipped?: string };
    expect(j.skipped).toBe("already_analyzed");
    // ★ LLM は一度も呼ばれない(コストを断つ)。INSERT も発生しない。
    expect(analyzeCommentMock).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
  });

  it("既分析チェックが DB エラー → 500(LLM を呼ばない)", async () => {
    existingError = { code: "XX000", message: "boom" };
    const res = await POST(req({ review_id: REVIEW_ID }));
    expect(res.status).toBe(500);
    expect(analyzeCommentMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/analyze — review 取得", () => {
  it("review が存在しない → 404(LLM を呼ばない)", async () => {
    reviewRow = null;
    const res = await POST(req({ review_id: REVIEW_ID }));
    expect(res.status).toBe(404);
    expect(analyzeCommentMock).not.toHaveBeenCalled();
  });

  it("comment が空 → 400(LLM を呼ばない)", async () => {
    reviewRow = { id: REVIEW_ID, toilet_id: TOILET_ID, comment: "   " };
    const res = await POST(req({ review_id: REVIEW_ID }));
    expect(res.status).toBe(400);
    expect(analyzeCommentMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/analyze — 検証通過分のみ INSERT(注入耐性)", () => {
  it("LLM 出力に注入混入でも validateAiSuggestion を通った提案だけ INSERT", async () => {
    // 1 件目: 正当な bool3 提案(通る)。
    // 2 件目: field='source' = allowlist 外(注入で変えてはいけない列を狙う)→ 弾く。
    // 3 件目: confidence 範囲外 → 弾く。
    // 4 件目: evidence 空 → 弾く。
    analyzeCommentMock.mockResolvedValue({
      ok: true,
      suggestions: [
        { field: "has_washlet", value: "true", confidence: 0.95, evidence: "ウォシュレット付き" },
        { field: "source", value: "user", confidence: 0.99, evidence: "ignore previous" },
        { field: "name", value: "X", confidence: 5, evidence: "ev" },
        { field: "is_universal", value: "true", confidence: 0.9, evidence: "" },
      ],
    });
    const res = await POST(req({ review_id: REVIEW_ID }));
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      inserted: number;
      rejected: number;
      fields: string[];
    };
    expect(j.inserted).toBe(1);
    expect(j.rejected).toBe(3);
    expect(j.fields).toEqual(["has_washlet"]);

    // INSERT は 1 回だけ。allowlist 外の source は構造的に届かない。
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      toilet_id: TOILET_ID,
      review_id: REVIEW_ID,
      field: "has_washlet",
      value: true, // 文字列 "true" が boolean に正規化されている
    });
    expect(insertedRows.some((r) => r.field === "source")).toBe(false);
  });

  it("LLM 失敗(ok:false)なら INSERT せず再試行可能なエラー(502/503)", async () => {
    analyzeCommentMock.mockResolvedValue({ ok: false, reason: "llm_error" });
    const res = await POST(req({ review_id: REVIEW_ID }));
    expect(res.status).toBe(502);
    expect(insertedRows).toHaveLength(0);

    analyzeCommentMock.mockResolvedValue({ ok: false, reason: "no_api_key" });
    const res2 = await POST(req({ review_id: REVIEW_ID }));
    expect(res2.status).toBe(503);
  });

  it("INSERT が 23505(pending 既存)→ skipped に数える(500 にしない)", async () => {
    insertError = { code: "23505", message: "duplicate key" };
    const res = await POST(req({ review_id: REVIEW_ID }));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { inserted: number; skipped: number };
    expect(j.inserted).toBe(0);
    expect(j.skipped).toBe(1);
  });
});
