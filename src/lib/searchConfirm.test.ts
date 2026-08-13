import { describe, expect, it } from "vitest";
import { shouldConfirmFirstSuggestion } from "./searchConfirm";

const ok = {
  isComposing: false,
  open: true,
  resultCount: 2,
  resultsQuery: "新宿駅",
  currentQuery: "新宿駅",
};

describe("shouldConfirmFirstSuggestion", () => {
  it("候補が現在の検索語と一致するときだけ確定する", () => {
    expect(shouldConfirmFirstSuggestion(ok)).toBe(true);
  });

  it("入力を変えた直後の旧候補では確定しない", () => {
    expect(
      shouldConfirmFirstSuggestion({ ...ok, resultsQuery: "博多駅", currentQuery: "新宿駅" }),
    ).toBe(false);
  });

  it("IME 変換中の Enter では確定しない", () => {
    expect(shouldConfirmFirstSuggestion({ ...ok, isComposing: true })).toBe(false);
  });

  it("候補が閉じていれば確定しない", () => {
    expect(shouldConfirmFirstSuggestion({ ...ok, open: false })).toBe(false);
  });
});
