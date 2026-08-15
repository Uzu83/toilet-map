import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  FEEDBACK_PROJECT_ID,
  assertFeedbackFirestore,
  initFeedbackFirestore,
} from './init';

describe('initFeedbackFirestore', () => {
  it('projectId が feedback-adcd2 以外なら throw する', () => {
    expect(() =>
      initFeedbackFirestore({
        apiKey: 'test',
        authDomain: 'example.firebaseapp.com',
        projectId: 'wifi-mimamori',
        appId: '1:1:web:1',
      }),
    ).toThrow(/feedback-adcd2/);
  });

  it('FEEDBACK_PROJECT_ID 定数は feedback-adcd2', () => {
    expect(FEEDBACK_PROJECT_ID).toBe('feedback-adcd2');
  });
});

describe('assertFeedbackFirestore', () => {
  it('ホスト等の別 projectId の Firestore なら throw する', () => {
    const foreignDb = {
      app: { options: { projectId: 'wifi-mimamori' } },
    } as unknown as Firestore;
    expect(() => assertFeedbackFirestore(foreignDb)).toThrow(/feedback-adcd2/);
  });

  it('feedback-adcd2 なら通す', () => {
    const okDb = {
      app: { options: { projectId: FEEDBACK_PROJECT_ID } },
    } as unknown as Firestore;
    expect(() => assertFeedbackFirestore(okDb)).not.toThrow();
  });
});
