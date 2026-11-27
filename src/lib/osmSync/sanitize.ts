const MAX_LEN = 500;

// 実行ログと HTTP レスポンスに載せる前に通す。個人情報は入力に無い想定だが、
// 秘密（Bearer、サービスキー、DB URL、env の値）が例外メッセージに混ざっても残さない。
export function sanitizeSyncError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "unknown error";
  let text = raw.replace(/\s+/g, " ").trim();
  const patterns = [
    /bearer\s+\S+/gi,
    /\b(?:sb_secret|sb_publishable|sbp)_[a-z0-9_-]+/gi,
    /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}/g,
    /postgres(?:ql)?:\/\/\S+/gi,
    /(CRON_SECRET|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|ADMIN_PASSWORD|ADMIN_SESSION_SECRET|IP_HASH_SALT)\s*[=:]\s*\S+/gi,
  ];
  for (const pattern of patterns) {
    text = text.replace(pattern, "[redacted]");
  }
  if (!text) return "unknown error";
  if (text.length <= MAX_LEN) return text;
  return `${text.slice(0, MAX_LEN - 1)}…`;
}
