/**
 * Enter で先頭候補を確定してよいか。
 * WHY: 入力変更後も旧 Nominatim 結果が残ると、画面の検索語と違う地点へ飛ぶ（GPT F002）。
 */
export function shouldConfirmFirstSuggestion(args: {
  isComposing: boolean;
  open: boolean;
  resultCount: number;
  resultsQuery: string;
  currentQuery: string;
}): boolean {
  if (args.isComposing) return false;
  if (!args.open || args.resultCount < 1) return false;
  return args.resultsQuery.trim() === args.currentQuery.trim();
}

export type SearchEnterAction =
  | "ignore"
  | "select-first"
  | "show-no-results"
  | "wait-for-current"
  | "search-now";

/**
 * 検索欄の Enter で何をするか。
 * WHY: デバウンス完了前は結果が空なので、そのまま空表示にすると
 * 「天神」のように実在する地名でも「見つからない」になり地図が動かない。
 * この語の検索が終わるまでは空表示にしない。
 */
export function searchEnterAction(args: {
  isComposing: boolean;
  currentQuery: string;
  open: boolean;
  resultCount: number;
  resultsQuery: string;
  busy: boolean;
  pending: boolean;
}): SearchEnterAction {
  if (args.isComposing) return "ignore";
  const query = args.currentQuery.trim();
  if (!query) return "ignore";
  if (
    shouldConfirmFirstSuggestion({
      isComposing: false,
      open: args.open,
      resultCount: args.resultCount,
      resultsQuery: args.resultsQuery,
      currentQuery: args.currentQuery,
    })
  ) {
    return "select-first";
  }
  // 候補は揃っているがドロップダウンが閉じている。語が一致するならそこへ行く。
  if (args.resultCount > 0 && args.resultsQuery.trim() === query) {
    return "select-first";
  }
  // 通信中に空表示すると、戻ってきた候補より先に「見つからない」が見える。
  if (args.busy) return "wait-for-current";
  if (!args.pending && args.resultsQuery.trim() === query && args.resultCount === 0) {
    return "show-no-results";
  }
  return "search-now";
}
