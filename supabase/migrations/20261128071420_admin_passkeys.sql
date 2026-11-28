-- 20261128071420_admin_passkeys.sql — Issue #61
-- 旧ファイル名 20261128065514_admin_passkeys.sql。
-- /admin のログインをパスキー(WebAuthn)にするための保存先。冪等。
-- 実行: supabase db push(先に --dry-run で確認)または Supabase ダッシュボード > SQL Editor で全文ペースト → Run。
-- 本番は 2026-11-28 にバージョン 20261128071420（名前 admin_passkeys）として適用済み。
-- 未適用の環境でパスキーの API を呼ぶと 500 になる(パスワードログインは影響なし)。
--
-- やること:
--   1. admin_passkeys: 登録済みパスキー(公開鍵)。管理者は社長 1 人なので user 列は持たない。
--      秘密鍵は端末から出ないので、ここにあるのは公開鍵と署名カウンタだけ。
--   2. admin_webauthn_challenges: 登録 / ログインの challenge。短命(アプリ側で 5 分)で 1 回だけ使う。
--      検証時に DELETE ... RETURNING で取り出すので、同じ challenge は 2 回使えない。
--
-- どちらもサーバ(secret key = service_role)からだけ触る。anon / authenticated には何も grant しない。
-- RLS は有効・ポリシー無し(= deny-all)。他の admin テーブルと同じ。
-- パスキーの削除(端末を失くした等)はダッシュボードの SQL Editor で行うので、service_role に DELETE を渡さない。

-- ───────────────────────────────────────────────────────────────────
-- (1) admin_passkeys
-- ───────────────────────────────────────────────────────────────────
create table if not exists admin_passkeys (
  -- WebAuthn の credential ID(base64url)
  credential_id text primary key check (char_length(credential_id) between 1 and 1024),
  -- COSE 公開鍵(base64url)
  public_key text not null check (char_length(public_key) between 1 and 4096),
  counter bigint not null default 0 check (counter >= 0),
  transports text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table admin_passkeys enable row level security;

revoke all on admin_passkeys from public, anon, authenticated;
grant select, insert, update on admin_passkeys to service_role;
revoke delete, truncate on admin_passkeys from service_role;

-- ───────────────────────────────────────────────────────────────────
-- (2) admin_webauthn_challenges
-- ───────────────────────────────────────────────────────────────────
create table if not exists admin_webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('registration', 'authentication')),
  challenge text not null check (char_length(challenge) between 16 and 512),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_webauthn_challenges_expires_idx
  on admin_webauthn_challenges (expires_at);

alter table admin_webauthn_challenges enable row level security;

revoke all on admin_webauthn_challenges from public, anon, authenticated;
-- DELETE は「1 回だけ取り出す」と「期限切れの掃除」に要る。UPDATE は要らない。
grant select, insert, delete on admin_webauthn_challenges to service_role;
revoke update, truncate on admin_webauthn_challenges from service_role;
