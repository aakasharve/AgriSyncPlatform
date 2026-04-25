/**
 * AI Doom Loop Detector — gate check.
 *
 * Validates the 7 invariants documented in
 * `_COFOUNDER/Projects/AgriSync/Operations/Guides/AI_DOOM_LOOP_DETECTOR_GUIDE.md`.
 *
 * Run: `npm run test:doom-loop`
 *
 * No vitest/jest dependency — follows the same pattern as
 * `scripts/voice_pipeline_gate_check.ts`. Exits 0 on all-pass, 1 on any failure.
 */

import { recordAiFailureSignature } from '../src/infrastructure/sync/AiDoomLoopDetector';
import type {
    PendingAiAttemptSignature,
    PendingAiJobContext,
    PendingAiJobRecord,
} from '../src/infrastructure/storage/DexieDatabase';

type CaseResult = {
    name: string;
    passed: boolean;
    detail: string;
};

const WINDOW_MS = 10 * 60 * 1000;

function makeJob(
    overrides: Partial<PendingAiJobRecord> = {},
    contextOverrides: Partial<PendingAiJobContext> = {},
): PendingAiJobRecord {
    return {
        operationType: 'voice_parse',
        context: {
            operation: 'voice',
            farmId: 'farm-1',
            plotId: 'plot-1',
            idempotencyKey: 'idem-1',
            ...contextOverrides,
        },
        status: 'failed',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        retryCount: 0,
        attemptSignatures: [],
        ...overrides,
    };
}

function applyDecision(
    job: PendingAiJobRecord,
    decision: ReturnType<typeof recordAiFailureSignature>,
): PendingAiJobRecord {
    return { ...job, attemptSignatures: decision.attemptSignatures };
}

function expect(condition: boolean, detail: string): CaseResult {
    return { name: '', passed: condition, detail };
}

// =============================================================================
// CASES
// =============================================================================

function caseOneFailureDoesNotStop(): CaseResult {
    const job = makeJob();
    const decision = recordAiFailureSignature(job, new Error('403 forbidden'), 1_000);
    const result = expect(
        decision.shouldStop === false &&
        decision.errorClass === 'auth_403' &&
        decision.attemptSignatures.length === 1,
        `shouldStop=${decision.shouldStop}, errorClass=${decision.errorClass}, sigs=${decision.attemptSignatures.length}`,
    );
    return { ...result, name: 'Single failure does NOT trigger stop' };
}

function caseTwoFailuresDoNotStop(): CaseResult {
    let job = makeJob();
    let d = recordAiFailureSignature(job, new Error('403 forbidden'), 1_000);
    job = applyDecision(job, d);
    d = recordAiFailureSignature(job, new Error('403 forbidden'), 2_000);
    const result = expect(
        d.shouldStop === false &&
        d.attemptSignatures.length === 1 &&
        d.attemptSignatures[0].count === 2,
        `shouldStop=${d.shouldStop}, count=${d.attemptSignatures[0]?.count}`,
    );
    return { ...result, name: 'Two identical failures do NOT trigger stop' };
}

function caseThreeFailuresStopOnNonTransient(): CaseResult {
    let job = makeJob();
    let d = recordAiFailureSignature(job, new Error('403 forbidden'), 1_000);
    job = applyDecision(job, d);
    d = recordAiFailureSignature(job, new Error('403 forbidden'), 2_000);
    job = applyDecision(job, d);
    d = recordAiFailureSignature(job, new Error('403 forbidden'), 3_000);
    const result = expect(
        d.shouldStop === true &&
        d.errorClass === 'auth_403' &&
        d.attemptSignatures[0].count === 3 &&
        d.reason !== undefined &&
        d.reason.includes('auth_403') &&
        d.reason.includes('10 minutes'),
        `shouldStop=${d.shouldStop}, reason=${d.reason ?? '(none)'}`,
    );
    return { ...result, name: 'Three identical NON-transient failures DO trigger stop' };
}

function caseTransientErrorsNeverStop(): CaseResult {
    const transientErrors = [
        'rate limit exceeded',
        '503 maintenance temporarily unavailable',
        'request timeout timed out',
        'network offline detected',
    ];

    let job = makeJob();
    let d: ReturnType<typeof recordAiFailureSignature> | null = null;
    let now = 1_000;

    for (let i = 0; i < 10; i++) {
        for (const msg of transientErrors) {
            d = recordAiFailureSignature(job, new Error(msg), now);
            job = applyDecision(job, d);
            now += 5_000;
        }
    }

    const result = expect(
        d !== null && d.shouldStop === false,
        `final shouldStop=${d?.shouldStop ?? 'null'}, sigs=${d?.attemptSignatures.length ?? 'null'}`,
    );
    return { ...result, name: 'Transient errors (rate_limit/maintenance/timeout/offline) NEVER trigger stop, even at 40 attempts' };
}

function caseWindowExpiry(): CaseResult {
    let job = makeJob();
    let d = recordAiFailureSignature(job, new Error('403 forbidden'), 1_000);
    job = applyDecision(job, d);
    d = recordAiFailureSignature(job, new Error('403 forbidden'), 2_000);
    job = applyDecision(job, d);

    const farFuture = 2_000 + WINDOW_MS + 5_000;
    d = recordAiFailureSignature(job, new Error('403 forbidden'), farFuture);

    const result = expect(
        d.shouldStop === false &&
        d.attemptSignatures.length === 1 &&
        d.attemptSignatures[0].count === 1,
        `shouldStop=${d.shouldStop}, sigs=${d.attemptSignatures.length}, count=${d.attemptSignatures[0]?.count}`,
    );
    return { ...result, name: 'Old signatures outside 10-min window are dropped (offline-then-back-online safe)' };
}

function caseRingBufferCap(): CaseResult {
    let job = makeJob();
    const distinctErrors = [
        '401 unauthorized',
        '403 forbidden',
        '400 bad request',
        '413 too large',
        'unexpected data format zod',
        'unknown weird thing',
        'another unique alpha',
        'another unique beta',
        'another unique gamma',
        'another unique delta',
    ];

    let d: ReturnType<typeof recordAiFailureSignature> | null = null;
    let now = 1_000;

    for (const msg of distinctErrors) {
        d = recordAiFailureSignature(job, new Error(msg), now);
        job = applyDecision(job, d);
        now += 1_000;
    }

    const result = expect(
        d !== null &&
        d.attemptSignatures.length <= 8 &&
        d.shouldStop === false,
        `sigs=${d?.attemptSignatures.length ?? 'null'} (cap=8), shouldStop=${d?.shouldStop ?? 'null'}`,
    );
    return { ...result, name: 'Ring buffer caps at MAX_SIGNATURES=8 with distinct errors' };
}

function caseFlagOffSemantics(): CaseResult {
    // The detector itself is pure — it always returns a decision. The flag
    // gating happens in the consumer (AiJobWorker). This test verifies the
    // pure-function contract: even on a "stop" decision, the function does NOT
    // mutate the input job.
    let job = makeJob();
    let d = recordAiFailureSignature(job, new Error('403 forbidden'), 1_000);
    job = applyDecision(job, d);
    d = recordAiFailureSignature(job, new Error('403 forbidden'), 2_000);
    job = applyDecision(job, d);

    const jobBefore: PendingAiAttemptSignature[] = job.attemptSignatures
        ? job.attemptSignatures.map((s) => ({ ...s }))
        : [];

    d = recordAiFailureSignature(job, new Error('403 forbidden'), 3_000);

    const result = expect(
        JSON.stringify(job.attemptSignatures) === JSON.stringify(jobBefore) &&
        d.shouldStop === true,
        'job.attemptSignatures was not mutated; new state lives in decision.attemptSignatures',
    );
    return { ...result, name: 'Detector is a pure function — does NOT mutate the job in place' };
}

// =============================================================================
// RUNNER
// =============================================================================

const cases: (() => CaseResult)[] = [
    caseOneFailureDoesNotStop,
    caseTwoFailuresDoNotStop,
    caseThreeFailuresStopOnNonTransient,
    caseTransientErrorsNeverStop,
    caseWindowExpiry,
    caseRingBufferCap,
    caseFlagOffSemantics,
];

const results = cases.map((fn) => fn());
const passed = results.filter((r) => r.passed);
const failed = results.filter((r) => !r.passed);

for (const r of results) {
    const tag = r.passed ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${r.name}`);
    if (!r.passed) {
        console.log(`       detail: ${r.detail}`);
    }
}

console.log('');
console.log(`AI Doom Loop Gate Check — ${passed.length}/${results.length} passed.`);

if (failed.length > 0) {
    console.error(`${failed.length} case(s) failed. See details above.`);
    process.exit(1);
}

process.exit(0);
