// agrisync-prompt-ops Phase 1 — Shared TypeScript types for the eval runner.
//
// These types describe the shape of:
//   - scenario YAML files (id + bucket + transcript + expected JSON + tolerances)
//   - fixture YAML files (farmer profile referenced by scenarios)
//   - per-run results and the aggregated run report
//
// Tolerance verbs map 1:1 to the entries documented in
// AGRISYNC_PROMPT_OPS_PLUGIN_2026-05-05.md §8.2.

export type BucketId =
  | 'workDone'
  | 'irrigation'
  | 'inputs'
  | 'labour'
  | 'machinery'
  | 'expenses'
  | 'tasks'
  | 'observations';

export const ALL_BUCKETS: readonly BucketId[] = [
  'workDone',
  'irrigation',
  'inputs',
  'labour',
  'machinery',
  'expenses',
  'tasks',
  'observations',
] as const;

export interface ScenarioInput {
  transcript?: string;
  audio?: string; // reserved — v0.1 supports transcript only
}

export interface ScenarioContext {
  fixture?: string;
  override?: Record<string, unknown>;
}

export type ToleranceRule =
  | { exact: true }
  | { '±%': number }
  | { '±': number }
  | { fuzzy: number }
  | { oneOf: unknown[] }
  | { set_match: true }
  | { regex: string };

export interface Scenario {
  id: string;
  bucket: BucketId;
  description?: string;
  input: ScenarioInput;
  context?: ScenarioContext;
  expected: Record<string, unknown>;
  tolerances?: Record<string, ToleranceRule>;
  ignore_fields?: string[];
}

export interface FieldDiff {
  fieldPath: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
  reason?: string;
}

export interface ScenarioResult {
  scenarioId: string;
  bucket: BucketId;
  source: 'live' | 'staging';
  passed: boolean;
  fieldDiffs: FieldDiff[];
  modelMs: number;
  promptVersion: string;
  cacheHit?: boolean;
  error?: string;
}

export interface BucketReport {
  bucket: BucketId;
  source: 'live' | 'staging';
  total: number;
  passed: number;
  failedScenarioIds: string[];
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  buckets: BucketReport[];
  regressions: { scenarioId: string; bucket: BucketId; passOnLive: boolean; passOnStaging: boolean }[];
  fixes: { scenarioId: string; bucket: BucketId }[];
  overall: 'pass' | 'fail';
}
