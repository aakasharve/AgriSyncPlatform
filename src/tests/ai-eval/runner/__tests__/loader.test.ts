// Loader unit tests — C9.3 golden corpus integrity.
//
// TDD: these assertions were written RED (asserting the final target count
// of 20 inputs scenarios + structural completeness) before all 14 new
// vlog fixtures were authored. They go GREEN once all fixtures exist.
//
// Rules encoded:
//   1. All inputs/ scenarios load without error.
//   2. Every scenario has a non-empty input.transcript.
//   3. Every scenario has a non-empty expected block.
//   4. No scenario carries a `score:` tolerance key (D-W1P1T3-SCORE).
//   5. inputs bucket has exactly 20 scenarios (6 pre-existing + 14 new).
//   6. Every vlog-date filename maps to a unique id.

import { describe, it, expect } from 'vitest';
import { loadScenariosForBucket, loadAllScenarios } from '../loader';

describe('loader — inputs bucket corpus integrity', () => {
  it('loads all 20 inputs scenarios without error', () => {
    const scenarios = loadScenariosForBucket('inputs');
    expect(scenarios).toHaveLength(20);
  });

  it('every scenario has a non-empty input.transcript', () => {
    const scenarios = loadScenariosForBucket('inputs');
    for (const s of scenarios) {
      expect(
        s.input.transcript,
        `scenario ${s.id} is missing input.transcript`
      ).toBeTruthy();
      expect(
        (s.input.transcript ?? '').trim().length,
        `scenario ${s.id} has an empty/whitespace transcript`
      ).toBeGreaterThan(0);
    }
  });

  it('every scenario has a non-empty expected block', () => {
    const scenarios = loadScenariosForBucket('inputs');
    for (const s of scenarios) {
      expect(
        s.expected,
        `scenario ${s.id} is missing expected block`
      ).toBeTruthy();
      expect(
        Object.keys(s.expected).length,
        `scenario ${s.id} has an empty expected block`
      ).toBeGreaterThan(0);
    }
  });

  it('no scenario uses a score: tolerance key (D-W1P1T3-SCORE decision)', () => {
    const scenarios = loadScenariosForBucket('inputs');
    for (const s of scenarios) {
      if (!s.tolerances) continue;
      for (const [field, rule] of Object.entries(s.tolerances)) {
        expect(
          'score' in rule,
          `scenario ${s.id} field "${field}" uses a score: tolerance — violates D-W1P1T3-SCORE`
        ).toBe(false);
      }
    }
  });

  it('all scenario ids are unique', () => {
    const scenarios = loadScenariosForBucket('inputs');
    const ids = scenarios.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(
      uniqueIds.size,
      `duplicate scenario ids found: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`
    ).toBe(ids.length);
  });

  it('all scenarios declare bucket: inputs', () => {
    const scenarios = loadScenariosForBucket('inputs');
    for (const s of scenarios) {
      expect(
        s.bucket,
        `scenario ${s.id} has bucket "${s.bucket}" instead of "inputs"`
      ).toBe('inputs');
    }
  });
});

describe('loader — loadAllScenarios includes inputs', () => {
  it('loadAllScenarios returns at least 20 scenarios (from inputs)', () => {
    const all = loadAllScenarios();
    const inputScenarios = all.filter((s) => s.bucket === 'inputs');
    expect(inputScenarios).toHaveLength(20);
  });
});
