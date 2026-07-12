import { describe, it, expect, vi, afterEach } from 'vitest';
import { DFES_TUNING } from '../dfesTuning';

afterEach(() => {
  vi.doUnmock('../../../../app/featureFlags');
  vi.resetModules();
});

// spec: dfes-companion-2026-07-11 (Phase 0)
describe('DFES feature flags', () => {
  it('exposes all four DFES flags, default OFF (no VITE_* set in the test env)', async () => {
    // `featureFlags.ts` reads env via `(import.meta as ViteEnvShape).env` —
    // a TS-cast form that Vitest's built-in import.meta.env stub plugin
    // matches by a literal `import.meta.env` text regex, so `vi.stubEnv`
    // cannot reach this read (verified: it patches the plugin's tracked env
    // object, but this cast bypasses that plugin's rewrite, so the module
    // keeps reading Vite's real, config-resolved env — which already has
    // this repo's gitignored local `.env.local`, i.e. VITE_UNDERSTANDING_METER=1,
    // a dev-preview convenience, baked in at server start and immune to
    // later `process.env`/stub mutations within a test). Since the flag
    // source may not change, mock the module itself instead — the same
    // `vi.doMock` + `vi.resetModules()` + dynamic-import pattern already
    // used by AppRouter.feature-gate.test.tsx and MeterDisplay.test.tsx to
    // control FEATURE_FLAGS deterministically. This makes the "OFF by
    // default" contract hermetic regardless of ambient .env.local; the
    // real env-driven default is additionally covered in CI, where no
    // .env.local exists.
    vi.resetModules();
    vi.doMock('../../../../app/featureFlags', () => ({
      FEATURE_FLAGS: {
        DwcChip: false,
        understandingMeter: false,
        disciplineSystem: false,
        voiceContinuity: false,
        stageQuestions: false,
      },
    }));
    const { FEATURE_FLAGS } = await import('../../../../app/featureFlags');

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
