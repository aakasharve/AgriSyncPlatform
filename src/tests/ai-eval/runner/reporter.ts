// agrisync-prompt-ops Phase 1 — Run reporter (md + json).
//
// Aggregates per-scenario results into a RunReport. The headline numbers
// are pass/total per (bucket × source). When BOTH live and staging results
// exist for the same scenario, we compute:
//   - regressions: passing on Live, failing on Staging  (block the lock)
//   - fixes:       failing on Live, passing on Staging  (the whole point)
//
// Markdown formatter is for terminals + skill output; json for CI consumers.
//
// failOnRegression is honored at two distinct layers — kept separate:
//   (1) reporter folds config.global.failOnRegression into `overall`:
//       (!failOnRegression || regressions.length === 0) && buckets.every(b => b.gatePassed)
//       — regressions only fail the run when the config says so.
//   (2) index.ts's --no-fail-on-regression CLI flag controls whether a non-'pass'
//       `overall` triggers process.exit(1) (index.ts:194, unchanged).
//   These are two separate switches; never collapse them.
//
// Floor semantics (hard-floor-for-all):
//   Every bucket has floor = bucketFloorOverrides[b] ?? minScenariosPerBucket;
//   belowFloor = total < floor always. A zero-scenario bucket FAILS unless its
//   floor is explicitly overridden to its real count (e.g. 0), per D-2 Option C.
//   This is the honesty fix — no bucket is silently un-tested.

import type { RunReport, ScenarioResult, BucketReport, EvalConfig } from './types';
import { ALL_BUCKETS } from './types';

const DEFAULT_THRESHOLD = 0.8;

export function buildReport(
  results: ScenarioResult[],
  startedAt: Date,
  finishedAt: Date,
  config: EvalConfig,
): RunReport {
  // Sources actually run (e.g. ['live'] for the CI default).
  const sources = Array.from(new Set(results.map((r) => r.source))) as ('live' | 'staging')[];

  const resolveFloor = (b: BucketReport['bucket']): number =>
    config.global.bucketFloorOverrides?.[b] ?? config.global.minScenariosPerBucket;

  const resolveThreshold = (b: BucketReport['bucket']): number =>
    config.thresholds[b] ?? DEFAULT_THRESHOLD;

  // Iterate ALL_BUCKETS for every source so zero-scenario buckets are surfaced
  // as belowFloor instead of being invisible. The old "buckets only from results
  // that ran" Object.entries loop is intentionally gone — that was the honesty bug.
  const buckets: BucketReport[] = [];
  for (const source of sources) {
    for (const bucket of ALL_BUCKETS) {
      const rs = results.filter((r) => r.bucket === bucket && r.source === source);
      const total = rs.length;
      const passed = rs.filter((r) => r.passed).length;
      const floor = resolveFloor(bucket);
      const threshold = resolveThreshold(bucket);
      // HARD for ALL buckets — a zero-scenario bucket fails unless its floor is
      // overridden to its real count (D-2 Option C).
      const belowFloor = total < floor;
      const belowThreshold = total > 0 && passed / total < threshold;
      buckets.push({
        bucket, source, total, passed,
        failedScenarioIds: rs.filter((r) => !r.passed).map((r) => r.scenarioId),
        floor, threshold, belowFloor, belowThreshold,
        gatePassed: !belowFloor && !belowThreshold,
      });
    }
  }

  // regressions/fixes computation is UNCHANGED — keep the existing live-vs-staging block.
  const regressions: RunReport['regressions'] = [];
  const fixes: RunReport['fixes'] = [];
  const liveResults = results.filter((r) => r.source === 'live');
  const stagingResults = results.filter((r) => r.source === 'staging');
  for (const live of liveResults) {
    const matchingStaging = stagingResults.find((s) => s.scenarioId === live.scenarioId);
    if (!matchingStaging) continue;
    if (live.passed && !matchingStaging.passed) {
      regressions.push({ scenarioId: live.scenarioId, bucket: live.bucket, passOnLive: true, passOnStaging: false });
    }
    if (!live.passed && matchingStaging.passed) {
      fixes.push({ scenarioId: live.scenarioId, bucket: live.bucket });
    }
  }

  const failOnRegression = config.global.failOnRegression;
  const overall: 'pass' | 'fail' =
    (!failOnRegression || regressions.length === 0) && buckets.every((b) => b.gatePassed)
      ? 'pass'
      : 'fail';

  return { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), buckets, regressions, fixes, overall };
}

export function formatMarkdown(report: RunReport, results: ScenarioResult[]): string {
  const lines: string[] = [];
  lines.push(`# Eval Run Report`);
  lines.push(``);
  lines.push(`**Started**: ${report.startedAt}`);
  lines.push(`**Finished**: ${report.finishedAt}`);
  lines.push(`**Overall**: ${report.overall === 'pass' ? 'PASS' : 'FAIL'}`);
  lines.push(``);
  lines.push(`## Per-bucket × source`);
  lines.push(``);
  lines.push(`| Bucket | Source | Pass | Total | Floor | Threshold | Gate |`);
  lines.push(`|--------|--------|------|-------|-------|-----------|------|`);
  for (const b of report.buckets) {
    let gate: string;
    if (b.belowFloor) {
      gate = `BELOW FLOOR ${b.total}/${b.floor}`;
    } else if (b.belowThreshold) {
      gate = `BELOW THRESHOLD`;
    } else {
      gate = `OK`;
    }
    lines.push(`| ${b.bucket} | ${b.source} | ${b.passed} | ${b.total} | ${b.floor} | ${b.threshold} | ${gate} |`);
  }
  lines.push(``);

  if (report.regressions.length > 0) {
    lines.push(`## Regressions (passing on Live, failing on Staging)`);
    lines.push(``);
    for (const r of report.regressions) {
      lines.push(`- ${r.bucket} / ${r.scenarioId}`);
    }
    lines.push(``);
  }
  if (report.fixes.length > 0) {
    lines.push(`## Newly fixed by Staging`);
    lines.push(``);
    for (const f of report.fixes) {
      lines.push(`- ${f.bucket} / ${f.scenarioId}`);
    }
    lines.push(``);
  }

  // Per-scenario field-level diffs — useful for the inner loop when
  // iterating on a single scenario via --scenario=<id>.
  if (results.length > 0) {
    lines.push(`## Per-scenario field diffs`);
    lines.push(``);
    for (const r of results) {
      lines.push(
        `### ${r.bucket} / ${r.scenarioId} (${r.source}) — ${r.passed ? 'PASS' : 'FAIL'}${r.cacheHit ? ' [mock]' : ''}`
      );
      lines.push(``);
      lines.push(`Prompt version: \`${r.promptVersion}\` · Model ms: ${r.modelMs}`);
      if (r.error) {
        lines.push(``);
        lines.push(`Error: ${r.error}`);
      }
      lines.push(``);
      const failures = r.fieldDiffs.filter((d) => !d.passed);
      if (failures.length === 0) {
        lines.push(`All fields passed.`);
      } else {
        lines.push(`| Field | Expected | Actual | Reason |`);
        lines.push(`|-------|----------|--------|--------|`);
        for (const d of failures) {
          lines.push(
            `| \`${d.fieldPath}\` | \`${truncate(JSON.stringify(d.expected))}\` | \`${truncate(JSON.stringify(d.actual))}\` | ${d.reason ?? ''} |`
          );
        }
      }
      lines.push(``);
    }
  }

  return lines.join('\n');
}

export function formatJson(report: RunReport, results: ScenarioResult[]): string {
  return JSON.stringify({ report, results }, null, 2);
}

function truncate(s: string | undefined, max = 80): string {
  const str = s ?? 'undefined';
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}
