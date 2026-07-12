import { describe, it, expect } from 'vitest';
import { FEATURE_FLAGS } from '../../../../app/featureFlags';

// spec: dfes-companion-2026-07-11 (Phase 0)
describe('DFES feature flags', () => {
  it('exposes all four DFES flags, default OFF (no VITE_* set in the test env)', () => {
    expect(FEATURE_FLAGS.understandingMeter).toBe(false);
    expect(FEATURE_FLAGS.disciplineSystem).toBe(false);
    expect(FEATURE_FLAGS.voiceContinuity).toBe(false);
    expect(FEATURE_FLAGS.stageQuestions).toBe(false);
  });
});
