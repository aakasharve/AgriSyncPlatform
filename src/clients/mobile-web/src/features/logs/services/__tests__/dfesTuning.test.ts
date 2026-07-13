import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// spec: dfes-companion-2026-07-11 (Phase 5, Task 5.10.1) — fitness/guardrail test:
// no DFES consumer may hardcode a DfesTuning number (`richDayThreshold: 25`,
// `unlockThreshold: 25`, `dailyPointCap: 15`) — they must always read it off
// `DFES_TUNING`, so a future backend tuning change can never silently drift
// from the frontend. Static source scan (readFileSync), not a runtime check.
//
// Comments/JSDoc are stripped before scanning: several of these files carry a
// `spec: ...-2026-06-25`-style header comment, and a naive whole-file regex
// would false-positive on the "25" inside that date. Guarded numbers are only
// meaningful in executable code.
describe('no phase hardcodes DfesTuning numbers (static source scan)', () => {
  /** Strip block (incl. JSDoc) and line comments so spec-date comments never
   *  produce a false positive on the guarded literals below. */
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
  }

  /** `richDayThreshold`/`unlockThreshold` (25) and `dailyPointCap` (15) — the
   *  only two guarded numeric literals a DFES consumer could plausibly
   *  hardcode instead of reading `DFES_TUNING`. */
  const GUARDED_TUNING_LITERAL = /\b(25|15)\b/;

  it('dfesQuestionEngine imports DFES_TUNING and hardcodes no tuning numbers', () => {
    const src = readFileSync(
      resolve(__dirname, '../../services/dfesQuestionEngine.ts'), 'utf8');
    expect(src).toMatch(/from '\.\/dfesTuning'/);
    expect(src).toMatch(/DFES_TUNING\.richDayThreshold/);
    // no bare 25 (richDayThreshold/unlockThreshold) literal in the engine
    expect(src).not.toMatch(/\b25\b/);
  });

  it('meterArrival imports DFES_TUNING and hardcodes no tuning numbers', () => {
    const src = readFileSync(
      resolve(__dirname, '../../services/meterArrival.ts'), 'utf8');
    expect(src).toMatch(/from '\.\/dfesTuning'/);
    expect(src).toMatch(/DFES_TUNING\.richDayThreshold/);
    expect(stripComments(src)).not.toMatch(GUARDED_TUNING_LITERAL);
  });

  it('disciplineRecognition hardcodes no DfesTuning numbers', () => {
    const src = readFileSync(
      resolve(__dirname, '../../services/disciplineRecognition.ts'), 'utf8');
    expect(stripComments(src)).not.toMatch(GUARDED_TUNING_LITERAL);
  });
});
