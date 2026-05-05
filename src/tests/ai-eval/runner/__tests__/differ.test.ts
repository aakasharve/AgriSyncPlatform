import { describe, it, expect } from 'vitest';
import { diffAgainstExpected } from '../differ';

describe('diffAgainstExpected', () => {
  it('passes when actual matches expected exactly', () => {
    const result = diffAgainstExpected(
      { inputs: [{ productName: 'Ethrel', dose: 4 }] },
      { inputs: [{ productName: 'Ethrel', dose: 4 }] },
      {},
      []
    );
    expect(result.passed).toBe(true);
    expect(result.fieldDiffs.every((d) => d.passed)).toBe(true);
  });

  it('fails when a leaf value differs', () => {
    const result = diffAgainstExpected(
      { inputs: [{ productName: 'Ethrel', dose: 4 }] },
      { inputs: [{ productName: 'Ethrel', dose: 5 }] },
      {},
      []
    );
    expect(result.passed).toBe(false);
  });

  it('respects per-field tolerance', () => {
    const result = diffAgainstExpected(
      { totalMl: 2400 },
      { totalMl: 2410 },
      { totalMl: { '±%': 1 } },
      []
    );
    expect(result.passed).toBe(true);
  });

  it('skips ignored top-level fields', () => {
    const result = diffAgainstExpected(
      { inputs: [], summary: 'expected text' },
      { inputs: [], summary: 'wildly different text' },
      {},
      ['summary']
    );
    expect(result.passed).toBe(true);
  });
});
