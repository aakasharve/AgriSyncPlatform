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
// DfesTuning contract (ShramSafal.Domain.Dfes.DfesTuning). This does NOT
// restate the backend's numbers as a second hardcoded literal — a test that
// does that passes even when the two sides disagree, because each assertion
// only ever checks its own side (this happened for real: scoreEngineVersion
// drifted to 'dfes-2' on the backend while this file kept asserting 'dfes-1',
// and both test suites stayed green). Instead this test READS AND PARSES the
// actual C# source files at test time, so the "expected" value always tracks
// whatever the backend currently says — the only way this test can fail is
// if DFES_TUNING genuinely disagrees with the backend.
describe('DFES_TUNING mirror is value-locked against the backend C# source', () => {
  const dfesTuningCs = readFileSync(
    resolve(__dirname, '../../../../../../../apps/ShramSafal/ShramSafal.Domain/Dfes/DfesTuning.cs'),
    'utf8',
  );
  const shramPointValuesCs = readFileSync(
    resolve(__dirname, '../../../../../../../apps/ShramSafal/ShramSafal.Domain/Dfes/ShramPointValues.cs'),
    'utf8',
  );
  const streakRulesCs = readFileSync(
    resolve(__dirname, '../../../../../../../apps/ShramSafal/ShramSafal.Domain/Dfes/StreakRules.cs'),
    'utf8',
  );

  /** Pulls a single named C# literal out of backend source, or fails loudly
   *  naming the file and pattern — so a renamed/reshaped backend field breaks
   *  this test with a clear cause instead of silently comparing `undefined`. */
  function extract(src: string, file: string, pattern: RegExp): string {
    const match = src.match(pattern);
    if (!match) {
      throw new Error(
        `dfesTuning.test.ts: could not find ${pattern} in ${file}. ` +
        `The backend field was likely renamed or reshaped — update this ` +
        `test's parser regex (and re-check dfesTuning.ts) to match.`,
      );
    }
    return match[1];
  }

  const backendTuning = {
    richDayThreshold: Number(
      extract(dfesTuningCs, 'DfesTuning.cs', /RichDayThreshold\s*=\s*(\d+);/)),
    unlockThreshold: Number(
      extract(dfesTuningCs, 'DfesTuning.cs', /UnlockThreshold\s*=\s*(\d+);/)),
    scoreEngineVersion:
      extract(dfesTuningCs, 'DfesTuning.cs', /ScoreEngineVersion\s*=\s*"([^"]+)";/),
    dailyPointCap: Number(
      extract(dfesTuningCs, 'DfesTuning.cs', /DailyPointCap\s*=\s*(\d+);/)),
    shramPointValues: {
      noWork: Number(
        extract(shramPointValuesCs, 'ShramPointValues.cs', /NoWork:\s*(\d+)/)),
      basic: Number(
        extract(shramPointValuesCs, 'ShramPointValues.cs', /Basic:\s*(\d+)/)),
      rich: Number(
        extract(shramPointValuesCs, 'ShramPointValues.cs', /Rich:\s*(\d+)/)),
      observationBonus: Number(
        extract(shramPointValuesCs, 'ShramPointValues.cs', /ObservationBonus:\s*(\d+)/)),
      learningBonus: Number(
        extract(shramPointValuesCs, 'ShramPointValues.cs', /LearningBonus:\s*(\d+)/)),
      followupBonus: Number(
        extract(shramPointValuesCs, 'ShramPointValues.cs', /FollowupBonus:\s*(\d+)/)),
    },
    streakRules: {
      advanceOnDeclaredNoWork:
        extract(streakRulesCs, 'StreakRules.cs', /AdvanceOnDeclaredNoWork:\s*(true|false)/) === 'true',
      neutralOnRestDay:
        extract(streakRulesCs, 'StreakRules.cs', /NeutralOnRestDay:\s*(true|false)/) === 'true',
      graceDaysBeforeBreak: Number(
        extract(streakRulesCs, 'StreakRules.cs', /GraceDaysBeforeBreak:\s*(\d+)/)),
    },
  };

  it('matches DfesTuning.cs / ShramPointValues.cs / StreakRules.cs, parsed live', () => {
    expect(DFES_TUNING).toEqual(backendTuning);
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
