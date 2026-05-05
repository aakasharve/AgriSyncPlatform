// agrisync-prompt-ops Phase 1 — Scenario + fixture YAML loader.
//
// Layout:
//   src/tests/ai-eval/scenarios/<bucket>/*.yaml  — canonical scenarios
//   src/tests/ai-eval/scenarios/<bucket>/.draft/*.yaml  — staged scenarios
//                                                        (only loaded when
//                                                        includeDrafts=true)
//   src/tests/ai-eval/fixtures/<name>.yaml      — farmer-context fixtures
//
// Resolution rule: a scenario's `context.fixture` references a fixture by
// bare name (no extension); the loader merges any `context.override` over
// the fixture's keys (override wins for duplicate keys).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { Scenario, BucketId } from './types';
import { ALL_BUCKETS } from './types';

// ESM equivalent of __dirname.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCENARIOS_ROOT = join(__dirname, '..', 'scenarios');
const FIXTURES_ROOT = join(__dirname, '..', 'fixtures');

export function loadScenariosForBucket(bucket: BucketId, includeDrafts = false): Scenario[] {
  const dir = join(SCENARIOS_ROOT, bucket);
  if (!existsSync(dir)) return [];

  const canonicalFiles = readdirSync(dir).filter(
    (f) => f.endsWith('.yaml') && !f.startsWith('.')
  );

  let allFiles: string[] = canonicalFiles;
  if (includeDrafts) {
    const draftDir = join(dir, '.draft');
    if (existsSync(draftDir)) {
      const draftFiles = readdirSync(draftDir)
        .filter((f) => f.endsWith('.yaml'))
        .map((f) => join('.draft', f));
      allFiles = [...allFiles, ...draftFiles];
    }
  }

  return allFiles.map((rel) => {
    const full = join(dir, rel);
    const raw = readFileSync(full, 'utf-8');
    const parsed = yaml.load(raw) as Scenario;
    parsed.id = parsed.id ?? basename(rel, '.yaml');
    parsed.bucket = parsed.bucket ?? bucket;
    return parsed;
  });
}

export function loadAllScenarios(): Scenario[] {
  return ALL_BUCKETS.flatMap((b) => loadScenariosForBucket(b, false));
}

export function loadFixture(name: string): Record<string, unknown> {
  const path = join(FIXTURES_ROOT, `${name}.yaml`);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${name} (looked at ${path})`);
  }
  return yaml.load(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

export function resolveContext(scenario: Scenario): Record<string, unknown> {
  const ctx = scenario.context;
  if (!ctx) return {};

  let base: Record<string, unknown> = {};
  if (ctx.fixture) {
    base = loadFixture(ctx.fixture);
  }
  if (ctx.override) {
    return { ...base, ...ctx.override };
  }
  return base;
}
