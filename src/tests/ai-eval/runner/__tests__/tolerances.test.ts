import { describe, it, expect } from 'vitest';
import { evaluateTolerance } from '../tolerances';

describe('evaluateTolerance', () => {
  it('exact: passes on equal numbers', () => {
    expect(evaluateTolerance(4, 4, { exact: true }).passed).toBe(true);
  });

  it('exact: fails on unequal numbers', () => {
    expect(evaluateTolerance(4, 5, { exact: true }).passed).toBe(false);
  });

  it('±%: passes within percent', () => {
    expect(evaluateTolerance(2400, 2410, { '±%': 1 }).passed).toBe(true);
  });

  it('±%: fails outside percent', () => {
    expect(evaluateTolerance(2400, 2500, { '±%': 1 }).passed).toBe(false);
  });

  it('±: passes within absolute tolerance', () => {
    expect(evaluateTolerance(2.5, 2.7, { '±': 0.5 }).passed).toBe(true);
  });

  it('fuzzy: passes when similarity >= threshold', () => {
    // Different scripts with no overlap → similarity is 0; fuzzy: 0.0 still passes.
    expect(evaluateTolerance('Ethrel', 'इथरेल', { fuzzy: 0.0 }).passed).toBe(true);
    // 1 substitution out of 6 chars → similarity ~0.83 ≥ 0.7.
    expect(evaluateTolerance('Ethrel', 'Ethrol', { fuzzy: 0.7 }).passed).toBe(true);
  });

  it('oneOf: passes when actual is in set', () => {
    expect(evaluateTolerance('Grape', 'Grape', { oneOf: ['Grape', 'द्राक्ष'] }).passed).toBe(
      true
    );
  });

  it('set_match: passes when arrays have same elements regardless of order', () => {
    expect(
      evaluateTolerance(
        [{ type: 'blower' }, { type: 'tractor' }],
        [{ type: 'tractor' }, { type: 'blower' }],
        { set_match: true }
      ).passed
    ).toBe(true);
  });

  it('regex: passes when string matches', () => {
    expect(
      evaluateTolerance('2026-05-05', '2026-05-05', { regex: '^\\d{4}-\\d{2}-\\d{2}$' }).passed
    ).toBe(true);
  });

  it('score: passes within ±pts (default 8) and fails outside', () => {
    const rule = { score: { expected: 86, '±pts': 8 } } as const;
    expect(evaluateTolerance(86, 86, rule).passed).toBe(true);   // Δ0
    expect(evaluateTolerance(86, 78, rule).passed).toBe(true);   // Δ8 (boundary)
    expect(evaluateTolerance(86, 94, rule).passed).toBe(true);   // Δ8 (boundary)
    expect(evaluateTolerance(86, 95, rule).passed).toBe(false);  // Δ9
  });

  it('score: ±pts defaults to 8 when omitted', () => {
    const rule = { score: { expected: 86 } } as const;
    expect(evaluateTolerance(86, 93, rule).passed).toBe(true);   // Δ7
    expect(evaluateTolerance(86, 95, rule).passed).toBe(false);  // Δ9
  });
});
