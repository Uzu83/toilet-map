import { timingSafeEqual } from "node:crypto";

// Vercel Cron は CRON_SECRET を Authorization: Bearer <secret> で送る。
// 未設定・空・不一致はすべて拒否（フェイルクローズ）。クエリ文字列では受けない。
export function cronAuthorized(
  authorizationHeader: string | null,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  const actual = authorizationHeader ?? "";
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
