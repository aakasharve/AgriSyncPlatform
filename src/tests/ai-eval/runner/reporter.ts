// agrisync-prompt-ops Phase 1 — Run reporter (md + json).
//
// Aggregates per-scenario results into a RunReport. The headline numbers
// are pass/total per (bucket × source). When BOTH live and staging results
// exist for the same scenario, we compute:
//   - regressions: passing on Live, failing on Staging  (block the lock)
//   - fixes:       failing on Live, passing on Staging  (the whole point)
//
// Markdown formatter is for terminals + skill output; json for CI consumers.

import type { RunReport, ScenarioResult, BucketReport } from './types';

export function buildReport(
  results: ScenarioResult[],
  startedAt: Date,
  finishedAt: Date
): RunReport {
  // Group by bucket × source.
  const byBucketSource: Record<string, ScenarioResult[]> = {};
  for (const r of results) {
    const k = `${r.bucket}|${r.source}`;
    (byBucketSource[k] ??= []).push(r);
  }

  const buckets: BucketReport[] = Object.entries(byBucketSource).map(([k, rs]) => {
    const [bucket, source] = k.split('|');
    return {
      bucket: bucket as BucketReport['bucket'],
      source: source as 'live' | 'staging',
      total: rs.length,
      passed: rs.filter((r) => r.passed).length,
      failedScenarioIds: rs.filter((r) => !r.passed).map((r) => r.scenarioId),
    };
  });

  // Compute regressions + fixes between live and staging runs of the same scenario.
  const regressions: RunReport['regressions'] = [];
  const fixes: RunReport['fixes'] = [];

  const liveResults = results.filter((r) => r.source === 'live');
  const stagingResults = results.filter((r) => r.source === 'staging');

  for (const live of liveResults) {
    const matchingStaging = stagingResults.find((s) => s.scenarioId === live.scenarioId);
    if (!matchingStaging) continue;

    if (live.passed && !matchingStaging.passed) {
      regressions.push({
        scenarioId: live.scenarioId,
        bucket: live.bucket,
        passOnLive: true,
        passOnStaging: false,
      });
    }
    if (!live.passed && matchingStaging.passed) {
      fixes.push({ scenarioId: live.scenarioId, bucket: live.bucket });
    }
  }

  const overall: 'pass' | 'fail' =
    regressions.length === 0 && buckets.every((b) => b.passed === b.total) ? 'pass' : 'fail';

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    buckets,
    regressions,
    fixes,
    overall,
  };
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
  lines.push(`| Bucket | Source | Pass | Total |`);
  lines.push(`|--------|--------|------|-------|`);
  for (const b of report.buckets) {
    lines.push(`| ${b.bucket} | ${b.source} | ${b.passed} | ${b.total} |`);
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
