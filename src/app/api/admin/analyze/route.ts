import { NextResponse, type NextRequest } from "next/server";
import { analyzeComment } from "@/lib/aiAnalysis";
import { noStore, requireAdminMutation } from "@/lib/adminHttp";
import { AiSuggestionValidationError, validateAiSuggestion } from "@/lib/aiSuggestion";
import { getServerSupabaseSecret } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

// secret(SUPABASE_SECRET_KEY / ADMIN_SESSION_SECRET / GOOGLE_GENERATIVE_AI_API_KEY)を読むため Node ランタイム固定。
//   ⚠️ aiAnalysis は server-only(Gemini キーを使う)。edge では動かさない。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ───────────────────────────────────────────────────────────────────
// POST /api/admin/analyze — レビューコメント 1 件を AI 分析し、提案を ai_suggestions に pending で積む(B1)
// ───────────────────────────────────────────────────────────────────
// スコープ(B1): 「全件 pending でキューに積む」だけ。自動反映(auto-apply)は B2。ここでは ai_apply_suggestion を呼ばない。
//
// 防御: requireAdminMutation(request) with NO rawId
//   ① getAdminSession → 401(proxy をすり抜けても権限の最終根拠はここ)
//   ② isSameOrigin → 403(cookie 認証の変更系なので CSRF を Origin/Host で確認)
//   ③ UUID は体内(body)で別途検証。rawId を渡さない = requireAdminMutation のステップ③はスキップ。
//   ④ noStore(モデレーション情報をキャッシュさせない)
// ⚠️ isSameOrigin は Origin/Referer 必須 deny なので batch/cron では通らない = ブラウザ起点オンデマンドのみ
//   (PHASE-B-DESIGN-BRIEF.md「API guard 再利用」)。これにより Gemini 無料枠の RPM 内に収める。
//
// ⚠️ LLM 失敗時は pending 行を作らない(Minor 論点5): analyzeComment が ok:false のとき INSERT しない
//   = 再試行可能(失敗を pending キューに混ぜない)。エラーログは原因種別のみ(本文/キー/raw 出力を出さない)。

export async function POST(request: NextRequest) {
  // requireAdminMutation(request) — rawId なし: session(401) → CSRF(403) のみ。
  //   review_id の UUID 検証は body パース後に行う(既存動作と同一)。
  const g = await requireAdminMutation(request);
  if (!g.ok) return g.res;

  // body から review_id を取る。uuid 形でなければ 400。
  let reviewId: string;
  try {
    const body = (await request.json()) as unknown;
    const candidate = (body as { review_id?: unknown })?.review_id;
    if (typeof candidate !== "string" || !isUuid(candidate)) {
      return noStore(NextResponse.json({ error: "review_id required" }, { status: 400 }));
    }
    reviewId = candidate;
  } catch {
    return noStore(NextResponse.json({ error: "invalid json" }, { status: 400 }));
  }

  try {
    const supabase = getServerSupabaseSecret();

    // 対象レビューの comment + toilet_id を引く。ip_hash は読まない(PII を LLM/レスポンスに乗せない)。
    const { data: review, error: reviewErr } = await supabase
      .from("reviews")
      .select("id, toilet_id, comment")
      .eq("id", reviewId)
      .maybeSingle();

    if (reviewErr) {
      // 生 DB 文言は返さない(内部スキーマ露出防止)。詳細はサーバログのみ。
      console.error("[api/admin/analyze] select review error", reviewErr);
      return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
    }
    if (!review) {
      return noStore(NextResponse.json({ error: "not found" }, { status: 404 }));
    }

    const comment = (review.comment as string | null) ?? "";
    const toiletId = review.toilet_id as string;
    if (comment.trim().length === 0) {
      // コメントが空のレビューは分析対象外(提案の素材が無い)。
      return noStore(NextResponse.json({ error: "review has no comment" }, { status: 400 }));
    }

    // ── 再分析の冪等スキップ(LLM 呼び出し前に断つ)──────────────────────
    // WHY ここで status 不問に「この review が既に分析済みか」を見る(Fix B / Codex medium + Claude low 採用):
    //   二重反映防止の部分 UNIQUE INDEX は status='pending' だけを dedup する(終端行は一意制約に絡まない =
    //   re-analyze で pending を積み直せる設計)。その裏返しで、同じ review×field を一度 approve/reject/no_op に
    //   終端させた"後で"再分析すると、終端行は INDEX 対象外なので新規 pending が再生成される。
    //   → キューの再汚染 + 同じコメントへの LLM 再呼び出し(Gemini 無料枠コストの無駄)が起きる。
    //   そこで「この review_id 由来の ai_suggestions 行が status 不問で 1 件でもあれば = 分析済み」とみなし、
    //   generateText(LLM)を呼ぶ前に early return する。INSERT のみならず LLM コストも断つのが肝(論点5 の
    //   「失敗は積まない」と直交 = こちらは「成功して終端化した過去分析を再実行しない」)。
    // ⚠️ トレードオフ(B1 では許容): 一度分析した review を後から再分析すれば、初回に取りこぼした field を
    //   新たに抽出できる可能性がある。その機会を捨てている(force-reanalyze は将来オプション)。B1 は
    //   「コスト+キュー汚染を断つ」を優先し、取りこぼしの再分析は手動運用(別レビューの追加等)に委ねる。
    const { data: existing, error: existErr } = await supabase
      .from("ai_suggestions")
      .select("id")
      .eq("review_id", reviewId)
      .limit(1)
      .maybeSingle();

    if (existErr) {
      // 生 DB 文言は返さない(内部スキーマ露出防止)。詳細はサーバログのみ。
      console.error("[api/admin/analyze] select existing suggestion error", existErr.code ?? existErr.message);
      return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
    }
    if (existing) {
      // 既に分析済み(終端/pending 問わず)。LLM 未呼び出しで返す = コスト+キュー再汚染を断つ。
      return noStore(NextResponse.json({ ok: true, skipped: "already_analyzed" }));
    }

    // ── AI 分析(1 コメント = 1 リクエスト)──
    const analysis = await analyzeComment(comment);
    if (!analysis.ok) {
      // ⚠️ 失敗時は pending を作らず再試行可能に(論点5)。reason は種別のみ(本文非露出)。
      //   no_api_key は設定不備(503 相当だが運用簡素化のため 502 でまとめず明示)、llm_error/empty_output は 502。
      const status = analysis.reason === "no_api_key" ? 503 : 502;
      return noStore(
        NextResponse.json({ error: "analysis unavailable", reason: analysis.reason }, { status }),
      );
    }

    // ── 検証を通過した提案だけを pending で INSERT(ON CONFLICT DO NOTHING 相当)──
    //   validateAiSuggestion を通らない提案(allowlist 外 field・型不一致・空 evidence 等)は捨てる。
    //   ⚠️ LLM 出力を直接 DB/RPC に流さない(ここで必ず検証 → 正規化済み value を積む)。
    let inserted = 0;
    let skipped = 0; // 既に同一 toilet×field の pending が存在(部分 UNIQUE INDEX に当たった)
    let rejected = 0; // 検証で弾いた(積まない)
    const fields: string[] = [];

    for (const raw of analysis.suggestions) {
      let normalized;
      try {
        normalized = validateAiSuggestion(raw.field, raw.value, raw.confidence, raw.evidence);
      } catch (err) {
        if (err instanceof AiSuggestionValidationError) {
          rejected += 1;
          continue;
        }
        throw err;
      }

      // ON CONFLICT DO NOTHING の実体: 部分 UNIQUE INDEX(toilet_id, field) WHERE status='pending' に当たると
      //   Postgres は 23505(unique_violation)を返す。PostgREST の onConflict は「列名のみ」で部分 index の
      //   WHERE 述語を表現できない(partial index を arbiter にできない)ため、素直に INSERT して 23505 を
      //   「skipped(既に pending あり)」として握る = 確実に DO NOTHING を再現する。
      const { error: insErr } = await supabase.from("ai_suggestions").insert({
        toilet_id: toiletId,
        review_id: reviewId,
        field: normalized.field,
        value: normalized.value, // string | boolean。jsonb 列に supabase-js が JSON 値として送る。
        confidence: normalized.confidence,
        evidence: normalized.evidence,
        // status は DB default 'pending'。明示しない(default に委ねる = 014 の CHECK と一致)。
      });

      if (insErr) {
        // 23505 = 既に同一 toilet×field の pending がある(部分 UNIQUE INDEX)。これは想定内 → skip。
        if (insErr.code === "23505") {
          skipped += 1;
          continue;
        }
        // それ以外の INSERT エラーは内部エラー(生文言は返さない)。
        console.error("[api/admin/analyze] insert suggestion error", insErr.code);
        return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
      }
      inserted += 1;
      fields.push(normalized.field);
    }

    // 結果サマリ(UI のトースト/再読込用)。提案本文は返すが、これは運営専用(noStore)なので許容。
    return noStore(NextResponse.json({ ok: true, inserted, skipped, rejected, fields }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[api/admin/analyze] unexpected error", message);
    return noStore(NextResponse.json({ error: "internal error" }, { status: 500 }));
  }
}
