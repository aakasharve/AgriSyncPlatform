#!/usr/bin/env tsx
// agrisync-prompt-ops Phase 1 — CLI entry for the eval runner.
//
// Usage examples:
//   npm run eval -- --bucket=inputs --source=live --mode=mock
//   npm run eval -- --bucket=all    --source=both --mode=mock
//   npm run eval -- --bucket=inputs --scenario=ethrel-blower-derivation \
//                   --source=live --mode=live
//
// Flags:
//   --bucket=<id|all>           required
//   --source=live|staging|both  default both
//   --mode=mock|live            default mock
//   --scenario=<id>             optional — filter to a single scenario
//   --rerecord                  force live call even in mock mode
//   --report=md|json            default md
//   --no-fail-on-regression     don't exit non-zero on regressions
//   --threshold=<float>         override per-bucket pass threshold
//   --endpoint=<url>            default http://localhost:5048/api/ai/eval-parse

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenariosForBucket, loadAllScenarios, resolveContext } from './loader';
import { executeScenario } from './executor';
import { diffAgainstExpected } from './differ';
import { buildReport, formatMarkdown, formatJson } from './reporter';
import type { Scenario, ScenarioResult, BucketId, EvalConfig } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CliFlags {
  bucket: string;
  source: 'live' | 'staging' | 'both';
  mode: 'mock' | 'live';
  scenario?: string;
  rerecord: boolean;
  report: 'md' | 'json';
  failOnRegression: boolean;
  threshold?: number;
  endpoint: string;
}

function parseFlags(argv: string[]): CliFlags {
  const get = (name: string, def?: string): string | undefined => {
    const v = argv.find((a) => a.startsWith(`--${name}=`));
    return v ? v.split('=').slice(1).join('=') : def;
  };
  const has = (name: string) => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

  const bucket = get('bucket');
  if (!bucket) {
    throw new Error('--bucket=<id|all> is required');
  }

  return {
    bucket,
    source: (get('source') ?? 'both') as CliFlags['source'],
    mode: (get('mode') ?? 'mock') as CliFlags['mode'],
    scenario: get('scenario'),
    rerecord: has('rerecord'),
    report: (get('report') ?? 'md') as CliFlags['report'],
    failOnRegression: !argv.includes('--no-fail-on-regression'),
    threshold: get('threshold') ? Number(get('threshold')) : undefined,
    endpoint: get('endpoint') ?? 'http://localhost:5048/api/ai/eval-parse',
  };
}

async function runOne(
  scenario: Scenario,
  source: 'live' | 'staging',
  flags: CliFlags
): Promise<ScenarioResult> {
  const context = resolveContext(scenario);
  try {
    const out = await executeScenario(scenario, context, {
      mode: flags.mode,
      source,
      endpoint: flags.endpoint,
      rerecord: flags.rerecord,
    });
    const diff = diffAgainstExpected(
      scenario.expected,
      out.parsed,
      scenario.tolerances ?? {},
      scenario.ignore_fields ?? []
    );
    return {
      scenarioId: scenario.id,
      bucket: scenario.bucket,
      source,
      passed: diff.passed && out.success,
      fieldDiffs: diff.fieldDiffs,
      modelMs: out.modelMs,
      promptVersion: out.promptVersion,
      cacheHit: out.cacheHit,
      error: out.success ? undefined : out.error,
    };
  } catch (e) {
    return {
      scenarioId: scenario.id,
      bucket: scenario.bucket,
      source,
      passed: false,
      fieldDiffs: [
        {
          fieldPath: '<runner>',
          expected: 'no error',
          actual: (e as Error).message,
          passed: false,
          reason: 'runner threw',
        },
      ],
      modelMs: 0,
      promptVersion: 'error',
      error: (e as Error).message,
    };
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  // Load eval.config.json — floors, thresholds, and failOnRegression policy.
  // The existing config has no bucketFloorOverrides (Task 3 adds them); it is
  // valid EvalConfig as-is (overrides are optional).
  const config: EvalConfig = JSON.parse(
    readFileSync(join(__dirname, '..', 'eval.config.json'), 'utf-8'),
  );
  const scenarios =
    flags.bucket === 'all'
      ? loadAllScenarios()
      : loadScenariosForBucket(flags.bucket as BucketId, false);

  const filtered = flags.scenario
    ? scenarios.filter((s) => s.id === flags.scenario)
    : scenarios;

  if (filtered.length === 0) {
    console.error(
      `No scenarios found for bucket=${flags.bucket}${flags.scenario ? ` scenario=${flags.scenario}` : ''}`
    );
    process.exit(1);
  }

  const sources: ('live' | 'staging')[] =
    flags.source === 'both' ? ['live', 'staging'] : [flags.source];

  const startedAt = new Date();
  const results: ScenarioResult[] = [];
  for (const s of filtered) {
    for (const src of sources) {
      try {
        results.push(await runOne(s, src, flags));
      } catch (e) {
        // Staging mode without a draft → just skip; not an error.
        if ((e as Error).message.includes('No staging draft')) continue;
        throw e;
      }
    }
  }
  const finishedAt = new Date();

  const report = buildReport(results, startedAt, finishedAt, config);
  const out =
    flags.report === 'md' ? formatMarkdown(report, results) : formatJson(report, results);

  if (flags.report === 'json') {
    process.stdout.write(out);
  } else {
    console.log(out);
  }

  // Persist report to _COFOUNDER staging area for skill consumption.
  // The staging dir is in a private nested git repo — the runner only writes;
  // _COFOUNDER/.gitignore excludes *.eval-*.{md,json} so reports stay local.
  const stagingDir = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '_COFOUNDER',
    'Projects',
    'AgriSync',
    'Operations',
    'AI',
    'PromptStaging'
  );
  try {
    mkdirSync(stagingDir, { recursive: true });
    const ts = startedAt.toISOString().replace(/[:.]/g, '-');
    const reportPath = join(stagingDir, `${flags.bucket}.eval-${ts}.${flags.report}`);
    writeFileSync(reportPath, out, 'utf-8');
  } catch (err) {
    // Don't fail the run if the report sink is missing — just log.
    console.error(`[runner] could not persist report to ${stagingDir}: ${(err as Error).message}`);
  }

  if (flags.failOnRegression && report.overall !== 'pass') {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
