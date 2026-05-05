// agrisync-prompt-ops Phase 1 — Tolerance verb evaluators.
//
// Implements the 7 tolerance rules from
// AGRISYNC_PROMPT_OPS_PLUGIN_2026-05-05.md §8.2:
//   exact          — JSON equality
//   ±%             — numeric, within percent
//   ±              — numeric, within absolute delta
//   fuzzy          — Levenshtein-similarity ≥ threshold
//   oneOf          — actual is one of N candidates
//   set_match      — arrays compared as sets (order-independent)
//   regex          — actual stringified matches the pattern
//
// Each evaluator returns { passed, reason } so the differ can attach a
// human-readable explanation to every field diff.

import type { ToleranceRule } from './types';

export interface ToleranceResult {
  passed: boolean;
  reason?: string;
}

export function evaluateTolerance(
  expected: unknown,
  actual: unknown,
  rule: ToleranceRule
): ToleranceResult {
  if ('exact' in rule && rule.exact === true) {
    return {
      passed: JSON.stringify(expected) === JSON.stringify(actual),
      reason: 'exact equality required',
    };
  }

  if ('±%' in rule) {
    const e = Number(expected);
    const a = Number(actual);
    if (Number.isNaN(e) || Number.isNaN(a)) {
      return { passed: false, reason: '±% requires numeric values' };
    }
    const pctDiff = e === 0 ? Math.abs(a) : Math.abs((a - e) / e) * 100;
    return { passed: pctDiff <= rule['±%'], reason: `pct diff ${pctDiff.toFixed(2)}%` };
  }

  if ('±' in rule) {
    const e = Number(expected);
    const a = Number(actual);
    if (Number.isNaN(e) || Number.isNaN(a)) {
      return { passed: false, reason: '± requires numeric values' };
    }
    return { passed: Math.abs(a - e) <= rule['±'], reason: `abs diff ${Math.abs(a - e)}` };
  }

  if ('fuzzy' in rule) {
    const e = String(expected ?? '');
    const a = String(actual ?? '');
    const similarity = computeSimilarity(e, a);
    return { passed: similarity >= rule.fuzzy, reason: `similarity ${similarity.toFixed(2)}` };
  }

  if ('oneOf' in rule) {
    const candidates = rule.oneOf;
    const actualStr = JSON.stringify(actual);
    const passed = candidates.some((c) => JSON.stringify(c) === actualStr);
    return { passed, reason: 'set membership' };
  }

  if ('set_match' in rule && rule.set_match === true) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return { passed: false, reason: 'set_match requires arrays' };
    }
    if (expected.length !== actual.length) {
      return { passed: false, reason: `length mismatch ${expected.length} vs ${actual.length}` };
    }
    const expectedKeys = expected.map((x) => JSON.stringify(x)).sort();
    const actualKeys = actual.map((x) => JSON.stringify(x)).sort();
    return {
      passed: JSON.stringify(expectedKeys) === JSON.stringify(actualKeys),
      reason: 'set equality',
    };
  }

  if ('regex' in rule) {
    const re = new RegExp(rule.regex);
    return { passed: re.test(String(actual ?? '')), reason: `regex /${rule.regex}/` };
  }

  return { passed: false, reason: 'unknown tolerance rule' };
}

function computeSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const maxLen = Math.max(a.length, b.length);
  const distance = levenshtein(a, b);
  return 1 - distance / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}
