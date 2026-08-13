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
