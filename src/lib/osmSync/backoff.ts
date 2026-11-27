// attempt は 0 始まり。初回は待たない。2 回目 500ms、3 回目 1000ms、以降倍々で 8 秒まで。
export function backoffDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt <= 0) return 0;
  const shift = Math.min(Math.floor(attempt) - 1, 16);
  return Math.min(8_000, 500 * 2 ** shift);
}

export function isOverpassTimeout(message: string): boolean {
  return /timeout|timed out|\babort|\b504\b/i.test(message);
}
