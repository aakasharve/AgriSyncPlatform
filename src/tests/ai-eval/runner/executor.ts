// agrisync-prompt-ops Phase 1 — Scenario executor.
//
// Two modes:
//   - mode=mock  — replays a recording from disk if present; falls back to
//                  network only if rerecord=true (or no recording exists)
//   - mode=live  — always calls the backend; saves recording on every run
//
// Recording key: (bucket, scenarioId, sha16(promptOverride))
//   When source=live (no override), promptOverride is empty string ⇒ stable sha.
//   When source=staging, sha changes per draft ⇒ each draft gets its own
//   recording slot, so mock-replay across drafts is unambiguous.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { Scenario, BucketId } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RECORDINGS_ROOT = join(__dirname, '..', 'recordings');

// Staging draft prompts live under _COFOUNDER (private nested repo). The
// runner only READS from there; lock-bucket is the only writer to the
// live prompt path.
const STAGING_ROOT = join(
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
  'PromptStaging',
  'buckets'
);

export type ExecMode = 'mock' | 'live';
export type Source = 'live' | 'staging';

export interface ExecOptions {
  mode: ExecMode;
  source: Source;
  endpoint: string;
  rerecord?: boolean;
}

export interface ExecResult {
  parsed: Record<string, unknown>;
  promptVersion: string;
  modelMs: number;
  cacheHit: boolean;
  success: boolean;
  error?: string;
}

interface RecordedResponse {
  parsed: Record<string, unknown>;
  promptVersion: string;
  modelMs: number;
  success: boolean;
  error?: string;
}

export async function executeScenario(
  scenario: Scenario,
  context: Record<string, unknown>,
  opts: ExecOptions
): Promise<ExecResult> {
  const promptOverride = resolvePromptOverride(scenario.bucket, opts.source);
  const promptSha = sha16(promptOverride ?? '');
  const recordingPath = join(
    RECORDINGS_ROOT,
    scenario.bucket,
    `${scenario.id}.${promptSha}.json`
  );

  // Mock path: replay if a recording exists and rerecord is not asked for.
  if (opts.mode === 'mock' && !opts.rerecord && existsSync(recordingPath)) {
    const cached = JSON.parse(readFileSync(recordingPath, 'utf-8')) as RecordedResponse;
    return {
      parsed: cached.parsed,
      promptVersion: cached.promptVersion,
      modelMs: cached.modelMs,
      cacheHit: true,
      success: cached.success,
      error: cached.error,
    };
  }

  // Live path (or mock with no recording): call endpoint.
  const transcript = scenario.input.transcript;
  if (!transcript) {
    throw new Error(`Scenario ${scenario.id}: only transcript-mode supported in v0.1`);
  }

  const resp = await fetch(opts.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AgriSync-Eval-Run': process.env.EVAL_RUN_ID ?? `local-${Date.now()}`,
    },
    body: JSON.stringify({
      transcript,
      context,
      promptOverride,
      scenarioId: scenario.id,
    }),
  });

  if (!resp.ok) {
    throw new Error(`eval-parse returned ${resp.status}: ${await resp.text()}`);
  }

  const json = (await resp.json()) as {
    parsed: Record<string, unknown>;
    promptVersion: string;
    modelMs: number;
    success: boolean;
    error?: string;
  };

  // Persist recording so subsequent --mode=mock runs replay without Gemini.
  mkdirSync(dirname(recordingPath), { recursive: true });
  const payload: RecordedResponse = {
    parsed: json.parsed ?? {},
    promptVersion: json.promptVersion ?? 'unknown',
    modelMs: json.modelMs ?? 0,
    success: json.success ?? true,
    error: json.error,
  };
  writeFileSync(recordingPath, JSON.stringify(payload, null, 2), 'utf-8');

  return { ...payload, cacheHit: false };
}

function resolvePromptOverride(bucket: BucketId, source: Source): string | null {
  if (source === 'live') {
    // null override → backend uses live prompt (built from registry).
    return null;
  }

  // staging — find the highest v<N>-draft.md
  if (!existsSync(STAGING_ROOT)) {
    throw new Error(
      `No staging directory found at ${STAGING_ROOT}. Run propose-patch first to create a draft.`
    );
  }

  const matches = readdirSync(STAGING_ROOT).filter((f) =>
    new RegExp(`^${bucket}\\.v\\d+-draft\\.md$`).test(f)
  );

  if (matches.length === 0) {
    throw new Error(
      `No staging draft for bucket ${bucket}. Run propose-patch ${bucket} first.`
    );
  }

  matches.sort((a, b) => {
    const va = Number(a.match(/v(\d+)-draft/)?.[1] ?? 0);
    const vb = Number(b.match(/v(\d+)-draft/)?.[1] ?? 0);
    return vb - va;
  });

  return readFileSync(join(STAGING_ROOT, matches[0]), 'utf-8');
}

function sha16(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
