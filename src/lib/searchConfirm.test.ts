import { describe, expect, it } from "vitest";
import { searchEnterAction, shouldConfirmFirstSuggestion } from "./searchConfirm";

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

describe("searchEnterAction", () => {
  const base = {
    isComposing: false,
    currentQuery: "天神",
    open: false,
    resultCount: 0,
    resultsQuery: "",
    busy: false,
    pending: true,
  };

  it("天神を入れてすぐ Enter したときは空表示にせず検索する", () => {
    expect(searchEnterAction(base)).toBe("search-now");
  });

  it("通信中の Enter は今の検索が戻るまで待つ", () => {
    expect(searchEnterAction({ ...base, pending: false, busy: true })).toBe("wait-for-current");
  });

  it("この語の検索が 0 件で終わった Enter は空表示", () => {
    expect(
      searchEnterAction({
        ...base,
        currentQuery: "ない地名",
        open: true,
        resultsQuery: "ない地名",
        pending: false,
      }),
    ).toBe("show-no-results");
  });

  it("候補が現在の語と一致すれば先頭を確定する", () => {
    expect(
      searchEnterAction({
        ...base,
        open: true,
        resultCount: 2,
        resultsQuery: "天神",
        pending: false,
      }),
    ).toBe("select-first");
  });

  it("別の語の旧候補では確定せず検索し直す", () => {
    expect(
      searchEnterAction({
        ...base,
        open: true,
        resultCount: 2,
        resultsQuery: "博多駅",
        pending: true,
      }),
    ).toBe("search-now");
  });

  it("IME 変換中と空文字は何もしない", () => {
    expect(searchEnterAction({ ...base, isComposing: true })).toBe("ignore");
    expect(searchEnterAction({ ...base, currentQuery: "  " })).toBe("ignore");
  });
});
