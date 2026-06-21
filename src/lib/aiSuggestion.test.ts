import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AiSuggestionValidationError,
  getAutoApplyThreshold,
  isAutoApplyEligible,
  validateAiSuggestion,
  type NormalizedAiSuggestion,
} from "./aiSuggestion";

// ───────────────────────────────────────────────────────────────────
// テストの射程
// ───────────────────────────────────────────────────────────────────
// aiSuggestion.ts は副作用なしの純関数モジュール(LLM 出力の検証 + 型強制 + 自動反映適格判定)。
// よってここでは実 DB/LLM なしで「allowlist・型強制・confidence 範囲・evidence 非空」と
// 「isAutoApplyEligible の bool3 + boolean + 閾値 + evidence 原文照合」を網羅的に検証できる
// (これらは「最終防壁」= LLM を信頼しない層なので、ロジックの正しさはユニットテストで担保する)。

describe("validateAiSuggestion — 通すべきもの", () => {
  it("bool3(boolean)+ confidence∈[0,1] + 非空 evidence を通し boolean を保つ", () => {
    for (const field of ["has_washlet", "has_diaper_table", "is_universal"] as const) {
      const r = validateAiSuggestion(field, true, 0.9, "ウォシュレットあり");
      expect(r.field).toBe(field);
      expect(r.value).toBe(true);
      expect(r.confidence).toBe(0.9);
      expect(r.evidence).toBe("ウォシュレットあり");
    }
  });

  it("bool3(文字列ゆれ 'yes'/'なし'/'true')を boolean に正規化する", () => {
    expect(validateAiSuggestion("has_washlet", "yes", 0.8, "washlet seat").value).toBe(true);
    expect(validateAiSuggestion("has_diaper_table", "なし", 0.8, "おむつ台なし").value).toBe(false);
    expect(validateAiSuggestion("is_universal", "true", 0.8, "多目的トイレ").value).toBe(true);
  });

  it("inferred_access(open/ask/permission)を通す", () => {
    for (const v of ["open", "ask", "permission"]) {
      const r = validateAiSuggestion("inferred_access", v, 0.7, `access is ${v}`);
      expect(r.value).toBe(v);
    }
  });

  it("name / opening_hours(文字列)を trim して通す", () => {
    expect(validateAiSuggestion("name", "  博多駅トイレ  ", 0.6, "博多駅").value).toBe("博多駅トイレ");
    expect(validateAiSuggestion("opening_hours", "24/7", 0.6, "24時間").value).toBe("24/7");
  });

  it("confidence の境界(0 と 1)を通す", () => {
    expect(validateAiSuggestion("name", "X", 0, "ev").confidence).toBe(0);
    expect(validateAiSuggestion("name", "Y", 1, "ev").confidence).toBe(1);
  });
});

describe("validateAiSuggestion — 弾くべきもの(AiSuggestionValidationError)", () => {
  it("field が allowlist 外 → 弾く(source / not_a_toilet / 未知)", () => {
    for (const bad of ["source", "not_a_toilet", "dominant_access", "unknown"]) {
      expect(() => validateAiSuggestion(bad, "x", 0.9, "ev")).toThrow(AiSuggestionValidationError);
    }
  });

  it("value の型違反 → 弾く", () => {
    // bool3 に boolean 化できない文字列。
    expect(() => validateAiSuggestion("has_washlet", "maybe", 0.9, "ev")).toThrow(
      AiSuggestionValidationError,
    );
    // bool3 に数値(boolean でも boolean-like string でもない)。
    expect(() => validateAiSuggestion("is_universal", 1, 0.9, "ev")).toThrow(
      AiSuggestionValidationError,
    );
    // inferred_access が enum 外。
    expect(() => validateAiSuggestion("inferred_access", "free", 0.9, "ev")).toThrow(
      AiSuggestionValidationError,
    );
    // name が文字列でない。
    expect(() => validateAiSuggestion("name", 123, 0.9, "ev")).toThrow(AiSuggestionValidationError);
  });

  it("confidence が範囲外 / 非数 → 弾く", () => {
    expect(() => validateAiSuggestion("name", "X", -0.1, "ev")).toThrow(AiSuggestionValidationError);
    expect(() => validateAiSuggestion("name", "X", 1.1, "ev")).toThrow(AiSuggestionValidationError);
    expect(() => validateAiSuggestion("name", "X", Number.NaN, "ev")).toThrow(
      AiSuggestionValidationError,
    );
    expect(() => validateAiSuggestion("name", "X", "0.9", "ev")).toThrow(AiSuggestionValidationError);
  });

  it("evidence が空 / 空白のみ / 非文字列 → 弾く", () => {
    expect(() => validateAiSuggestion("name", "X", 0.9, "")).toThrow(AiSuggestionValidationError);
    expect(() => validateAiSuggestion("name", "X", 0.9, "   ")).toThrow(AiSuggestionValidationError);
    expect(() => validateAiSuggestion("name", "X", 0.9, null)).toThrow(AiSuggestionValidationError);
  });
});

describe("isAutoApplyEligible — bool3 + boolean + 閾値 + evidence 原文照合 のみ true", () => {
  const THRESHOLD = 0.85;
  // ベース: bool3 + boolean + 高 confidence + evidence は原文の部分文字列。
  const sourceComment = "ここはウォシュレット付きでとても綺麗でした";
  function sugg(over: Partial<NormalizedAiSuggestion> = {}): NormalizedAiSuggestion {
    return {
      field: "has_washlet",
      value: true,
      confidence: 0.95,
      evidence: "ウォシュレット付き",
      ...over,
    };
  }

  it("全条件を満たす → true", () => {
    expect(isAutoApplyEligible(sugg(), sourceComment, THRESHOLD)).toBe(true);
  });

  it("bool3 でない field(inferred_access / name)→ false", () => {
    expect(
      isAutoApplyEligible(
        sugg({ field: "inferred_access", value: "open", evidence: "ウォシュレット付き" }),
        sourceComment,
        THRESHOLD,
      ),
    ).toBe(false);
    expect(
      isAutoApplyEligible(sugg({ field: "name", value: "綺麗" }), "綺麗なトイレ", THRESHOLD),
    ).toBe(false);
  });

  it("value が boolean でない → false", () => {
    // 型上は string|boolean。boolean 以外(string)を渡したら適格でない。
    expect(
      isAutoApplyEligible(
        sugg({ value: "true" as unknown as boolean }),
        sourceComment,
        THRESHOLD,
      ),
    ).toBe(false);
  });

  it("confidence < 閾値 → false", () => {
    expect(isAutoApplyEligible(sugg({ confidence: 0.84 }), sourceComment, THRESHOLD)).toBe(false);
  });

  it("evidence が原文の部分文字列でない(要約/翻訳)→ false", () => {
    expect(
      isAutoApplyEligible(sugg({ evidence: "has a washlet" }), sourceComment, THRESHOLD),
    ).toBe(false);
  });

  it("evidence 照合は大文字小文字を無視する", () => {
    expect(
      isAutoApplyEligible(
        sugg({ evidence: "WASHLET" }),
        "This toilet has a washlet seat",
        THRESHOLD,
      ),
    ).toBe(true);
  });
});

describe("getAutoApplyThreshold — env 解釈(既定 0.85)", () => {
  const ORIG = process.env.AI_AUTO_APPLY_THRESHOLD;
  beforeEach(() => {
    delete process.env.AI_AUTO_APPLY_THRESHOLD;
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.AI_AUTO_APPLY_THRESHOLD;
    else process.env.AI_AUTO_APPLY_THRESHOLD = ORIG;
  });

  it("未設定なら 0.85", () => {
    expect(getAutoApplyThreshold()).toBe(0.85);
  });

  it("妥当な値(0..1)はそのまま採用", () => {
    process.env.AI_AUTO_APPLY_THRESHOLD = "0.9";
    expect(getAutoApplyThreshold()).toBe(0.9);
  });

  it("不正値(範囲外/非数)は既定 0.85 にフォールバック", () => {
    process.env.AI_AUTO_APPLY_THRESHOLD = "1.5";
    expect(getAutoApplyThreshold()).toBe(0.85);
    process.env.AI_AUTO_APPLY_THRESHOLD = "abc";
    expect(getAutoApplyThreshold()).toBe(0.85);
  });
});
