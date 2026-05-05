// agrisync-prompt-ops Phase 1 — Recursive tolerance-aware comparison.
//
// Walks the expected JSON tree and, for each leaf:
//   - if the field path has a tolerance rule, applies that rule and stops
//   - otherwise falls back to JSON deep equality
//
// Top-level keys listed in `ignore_fields` are pruned before walking.
//
// Path syntax follows the scenario YAML conventions:
//   "inputs[0].productName"
//   "machinery"
//   "expenses.totals.netMl"
// — array index uses [N], object keys use dotted access.

import type { FieldDiff, ToleranceRule } from './types';
import { evaluateTolerance } from './tolerances';

interface DiffOutput {
  passed: boolean;
  fieldDiffs: FieldDiff[];
}

export function diffAgainstExpected(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  tolerances: Record<string, ToleranceRule>,
  ignoreFields: string[]
): DiffOutput {
  const fieldDiffs: FieldDiff[] = [];
  walk(expected, actual, '', tolerances, ignoreFields, fieldDiffs);
  return {
    passed: fieldDiffs.every((d) => d.passed),
    fieldDiffs,
  };
}

function walk(
  expected: unknown,
  actual: unknown,
  path: string,
  tolerances: Record<string, ToleranceRule>,
  ignoreFields: string[],
  out: FieldDiff[]
): void {
  // Top-level field ignore — only prunes keys named at the root.
  if (path) {
    const topLevel = path.split(/[.[]/, 1)[0];
    if (topLevel && ignoreFields.includes(topLevel)) {
      return;
    }
  }

  // If a tolerance rule exists for this exact path, apply it and stop descending.
  const rule = tolerances[path];
  if (rule) {
    const r = evaluateTolerance(expected, actual, rule);
    out.push({ fieldPath: path, expected, actual, passed: r.passed, reason: r.reason });
    return;
  }

  // Both arrays — descend element-by-element (default: index-based).
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      out.push({
        fieldPath: path,
        expected,
        actual,
        passed: false,
        reason: `array length ${expected.length} vs ${actual.length}`,
      });
      return;
    }
    for (let i = 0; i < expected.length; i++) {
      walk(expected[i], actual[i], `${path}[${i}]`, tolerances, ignoreFields, out);
    }
    return;
  }

  // Both objects — descend by keys defined on expected (partial-match semantics).
  if (
    expected &&
    typeof expected === 'object' &&
    actual &&
    typeof actual === 'object' &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    for (const key of Object.keys(expected as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      walk(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        childPath,
        tolerances,
        ignoreFields,
        out
      );
    }
    return;
  }

  // Leaf — default exact equality.
  const passed = JSON.stringify(expected) === JSON.stringify(actual);
  out.push({
    fieldPath: path || '<root>',
    expected,
    actual,
    passed,
    reason: passed ? undefined : 'leaf mismatch',
  });
}
