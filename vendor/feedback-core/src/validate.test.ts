import { describe, expect, it } from 'vitest';
import { CONSENT_VERSION, CONTACT_RETENTION_DAYS } from './schema';
import { normalizeScreen, validateFeedback } from './validate';

const base = {
  product: 'chess-japan',
  kind: 'bug' as const,
  message: '解説が出ません',
  wantsReply: false,
};

const NOW = new Date('2026-08-13T00:00:00.000Z');

describe('validateFeedback', () => {
  it('既定は完全匿名（連絡先を作らない）', () => {
    const r = validateFeedback(base, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contact).toBeNull();
    expect(r.feedback.wantsReply).toBe(false);
    expect(r.feedback.status).toBe('new');
  });

  /*
   * 最重要の不変条件。「返信不要」なのに連絡先が残ると、保存しないという約束を破る。
   * UI でチェックを外しても入力欄の値が残るケースがあるため、契約層で捨てる。
   */
  it('返信不要ならメールが入力されていても保存しない', () => {
    const r = validateFeedback({ ...base, contactEmail: 'a@example.com' }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contact).toBeNull();
  });

  it('返信希望なら連絡先を別文書に分け、同意バージョンと期限を持たせる', () => {
    const r = validateFeedback(
      { ...base, wantsReply: true, contactEmail: 'a@example.com' },
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || !r.contact) return;
    expect(r.contact.email).toBe('a@example.com');
    expect(r.contact.consentVersion).toBe(CONSENT_VERSION);
    const days = (r.contact.expiresAt.getTime() - NOW.getTime()) / 86_400_000;
    expect(days).toBe(CONTACT_RETENTION_DAYS);
  });

  it('本体の文書には個人情報を入れない', () => {
    const r = validateFeedback(
      { ...base, wantsReply: true, contactEmail: 'a@example.com' },
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.feedback)).not.toContain('a@example.com');
  });

  it('返信希望なのにメールが無ければエラー', () => {
    const r = validateFeedback({ ...base, wantsReply: true }, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe('contactEmail');
  });

  it('メールの形が明らかにおかしければエラー', () => {
    const r = validateFeedback({ ...base, wantsReply: true, contactEmail: 'not-an-email' }, NOW);
    expect(r.ok).toBe(false);
  });

  it('空の本文を拒否する', () => {
    expect(validateFeedback({ ...base, message: '   ' }, NOW).ok).toBe(false);
  });

  it('長すぎる本文を拒否する', () => {
    const r = validateFeedback({ ...base, message: 'あ'.repeat(2001) }, NOW);
    expect(r.ok).toBe(false);
  });

  it('制御文字を落とし、改行は残す', () => {
    const r = validateFeedback({ ...base, message: 'a\u0000b\nc' }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.feedback.message).toBe('ab\nc');
  });

  it('未知の platform は null に倒す', () => {
    const r = validateFeedback(
      { ...base, platform: 'nintendo' as unknown as 'web' },
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.feedback.platform).toBeNull();
  });
});

describe('normalizeScreen', () => {
  /*
   * query / hash にセッション ID や検索語が乗ることがある。落とすのはこちらの責任。
   */
  it('URL は origin + pathname だけにする', () => {
    expect(normalizeScreen('https://chess-japan.pages.dev/review?token=secret#x')).toBe(
      'https://chess-japan.pages.dev/review',
    );
  });

  it('URL でなければそのまま（長さだけ切る）', () => {
    expect(normalizeScreen('/review')).toBe('/review');
  });

  it('未指定は null', () => {
    expect(normalizeScreen(undefined)).toBeNull();
    expect(normalizeScreen('  ')).toBeNull();
  });
});
