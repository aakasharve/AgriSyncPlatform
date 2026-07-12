import { describe, it, expect } from 'vitest';
import { FEATURE_FLAGS } from '../../../../app/featureFlags';
import { DFES_TUNING } from '../dfesTuning';

// spec: dfes-companion-2026-07-11 (Phase 0)
describe('DFES feature flags', () => {
  it('exposes all four DFES flags, default OFF (no VITE_* set in the test env)', () => {
    expect(FEATURE_FLAGS.understandingMeter).toBe(false);
    expect(FEATURE_FLAGS.disciplineSystem).toBe(false);
    expect(FEATURE_FLAGS.voiceContinuity).toBe(false);
    expect(FEATURE_FLAGS.stageQuestions).toBe(false);
  });
});

// spec: dfes-companion-2026-07-11 (Phase 0) — mirror must equal the backend
// DfesTuning contract (ShramSafal.Domain.Dfes.DfesTuning). Same numbers, both
// sides value-locked. If this drifts from DfesTuningTests.cs, one side is wrong.
describe('DFES_TUNING mirror', () => {
  it('matches the locked backend contract', () => {
    expect(DFES_TUNING).toEqual({
      richDayThreshold: 25,
      unlockThreshold: 25,
      scoreEngineVersion: 'dfes-1',
      dailyPointCap: 15,
      shramPointValues: {
        noWork: 2, basic: 5, rich: 10,
        observationBonus: 3, learningBonus: 5, followupBonus: 2,
      },
      streakRules: {
        advanceOnDeclaredNoWork: true,
        neutralOnRestDay: true,
        graceDaysBeforeBreak: 1,
      },
    });
  });
});
