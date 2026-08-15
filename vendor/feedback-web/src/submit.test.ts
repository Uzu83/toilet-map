import { describe, expect, it } from 'vitest';
import { CONTACT_RETENTION_DAYS, CONSENT_VERSION } from '@tosagiken/feedback-core';
import * as web from './index';
import {
  COLLECTIONS,
  CONTACT_PERSISTENCE_ENABLED,
  CONTACT_WRITE_KEYS,
  DEFAULT_FEEDBACK_TARGET,
  FEEDBACK_APP_NAME,
  FEEDBACK_PROJECT_ID,
  FEEDBACK_WRITE_KEYS,
  planFeedbackWrite,
  rejectIfContactPersistenceDisabled,
} from './index';

const NOW = new Date('2026-08-13T00:00:00.000Z');
const FIXED_ID = '11111111-1111-4111-8111-111111111111';

const base = {
  product: 'chess-japan',
  kind: 'bug' as const,
  message: '解説が出ません',
  wantsReply: false,
};

describe('planFeedbackWrite', () => {
  it('既定ターゲットは dev（本番 feedback を汚さない）', () => {
    const r = planFeedbackWrite(base, { now: NOW, id: FIXED_ID });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.target).toBe(DEFAULT_FEEDBACK_TARGET);
    expect(r.plan.feedbackCollection).toBe(COLLECTIONS.feedbackDev);
    expect(r.plan.id).toBe(FIXED_ID);
  });

  it('返信不要なら contact を作らない（メールが入力されていても捨てる）', () => {
    const r = planFeedbackWrite(
      { ...base, contactEmail: 'a@example.com' },
      { now: NOW, id: FIXED_ID },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.contactData).toBeNull();
    expect(r.plan.feedbackData.wantsReply).toBe(false);
  });

  it('返信希望なら同じ id で contact を作り、expiresAt は 30日後かつ 31日未満', () => {
    const r = planFeedbackWrite(
      { ...base, wantsReply: true, contactEmail: 'a@example.com' },
      { now: NOW, id: FIXED_ID },
    );
    expect(r.ok).toBe(true);
    if (!r.ok || !r.plan.contactData) return;
    expect(r.plan.contactData.email).toBe('a@example.com');
    expect(r.plan.contactData.consentVersion).toBe(CONSENT_VERSION);
    const days =
      (r.plan.contactData.expiresAt.toMillis() - NOW.getTime()) / 86_400_000;
    expect(days).toBe(CONTACT_RETENTION_DAYS);
    expect(days).toBeLessThan(31);
  });

  it('本体に個人情報を入れない', () => {
    const r = planFeedbackWrite(
      { ...base, wantsReply: true, contactEmail: 'a@example.com' },
      { now: NOW, id: FIXED_ID },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.plan.feedbackData)).not.toContain('a@example.com');
  });

  it('status は必ず new。createdAt は serverTimestamp sentinel（Date や null ではない）', () => {
    const r = planFeedbackWrite(base, { now: NOW, id: FIXED_ID });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.feedbackData.status).toBe('new');
    expect(r.plan.feedbackData.createdAt).not.toBeNull();
    expect(r.plan.feedbackData.createdAt).not.toBeInstanceOf(Date);
  });

  it('feedback のキーは rules allowlist と一致する（未知フィールドを足さない）', () => {
    const r = planFeedbackWrite(base, { now: NOW, id: FIXED_ID });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.plan.feedbackData).sort()).toEqual([...FEEDBACK_WRITE_KEYS].sort());
  });

  it('contact のキーは rules allowlist と一致する', () => {
    const r = planFeedbackWrite(
      { ...base, wantsReply: true, contactEmail: 'a@example.com' },
      { now: NOW, id: FIXED_ID },
    );
    expect(r.ok).toBe(true);
    if (!r.ok || !r.plan.contactData) return;
    expect(Object.keys(r.plan.contactData).sort()).toEqual([...CONTACT_WRITE_KEYS].sort());
  });

  it('返信希望なのにメールが無ければエラー（書き込み計画を作らない）', () => {
    const r = planFeedbackWrite({ ...base, wantsReply: true }, { now: NOW });
    expect(r.ok).toBe(false);
  });

  it('target: prod のときだけ本番コレクション名になる', () => {
    const r = planFeedbackWrite(base, { now: NOW, id: FIXED_ID, target: 'prod' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.feedbackCollection).toBe(COLLECTIONS.feedback);
  });
});

describe('contact persistence (Spark / GPT review)', () => {
  it('CONTACT_PERSISTENCE_ENABLED は false（TTL が走るまでメールを書かない）', () => {
    expect(CONTACT_PERSISTENCE_ENABLED).toBe(false);
  });

  it('返信希望の plan は submit 前に拒否する（本文だけ書いてメールを捨てない）', () => {
    const r = planFeedbackWrite(
      { ...base, wantsReply: true, contactEmail: 'a@example.com' },
      { now: NOW, id: FIXED_ID },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const blocked = rejectIfContactPersistenceDisabled(r.plan);
    expect(blocked?.ok).toBe(false);
    if (!blocked || blocked.ok) return;
    expect(blocked.field).toBe('wantsReply');
  });

  it('匿名の plan は通す', () => {
    const r = planFeedbackWrite(base, { now: NOW, id: FIXED_ID });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(rejectIfContactPersistenceDisabled(r.plan)).toBeNull();
  });
});

describe('named Firebase app', () => {
  it('feedback-adcd2 専用名でありホストのデフォルトアプリに相乗りしない', () => {
    expect(FEEDBACK_APP_NAME).toBe('feedback-adcd2');
    expect(FEEDBACK_PROJECT_ID).toBe('feedback-adcd2');
  });
});

describe('public API', () => {
  /*
   * クライアントから read/update/delete できない、のコード側担保。
   * 真の強制は rules。ここは「間違って便利関数を export しない」ための回帰防止。
   */
  it('getDoc / updateDoc / deleteDoc を export しない', () => {
    expect(web).not.toHaveProperty('getDoc');
    expect(web).not.toHaveProperty('updateDoc');
    expect(web).not.toHaveProperty('deleteDoc');
    expect(web).not.toHaveProperty('getDocs');
    expect(typeof web.submitFeedback).toBe('function');
  });
});
