import type { PendingAiAttemptSignature, PendingAiJobRecord } from '../storage/DexieDatabase';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REPEATS = 3;
const MAX_SIGNATURES = 8;

const TRANSIENT_CLASSES = new Set([
    'rate_limit_429',
    'maintenance_503',
    'network_timeout',
    'network_offline',
]);

export interface DoomLoopDecision {
    shouldStop: boolean;
    reason?: string;
    signature: string;
    errorClass: string;
    attemptSignatures: PendingAiAttemptSignature[];
}

function normalizeErrorMessage(error: unknown): string {
    const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : String(error || 'unknown error');

    return message
        .toLowerCase()
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
        .replace(/\b\d{3,}\b/g, '<n>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

function classifyError(normalizedMessage: string): string {
    if (normalizedMessage.includes('429') || normalizedMessage.includes('rate limit') || normalizedMessage.includes('too many requests')) {
        return 'rate_limit_429';
    }

    if (normalizedMessage.includes('503') || normalizedMessage.includes('maintenance') || normalizedMessage.includes('temporarily unavailable')) {
        return 'maintenance_503';
    }

    if (normalizedMessage.includes('offline') || normalizedMessage.includes('network')) {
        return 'network_offline';
    }

    if (normalizedMessage.includes('timeout') || normalizedMessage.includes('timed out')) {
        return 'network_timeout';
    }

    if (normalizedMessage.includes('401') || normalizedMessage.includes('unauthorized')) {
        return 'auth_401';
    }

    if (normalizedMessage.includes('403') || normalizedMessage.includes('forbidden')) {
        return 'auth_403';
    }

    if (normalizedMessage.includes('400') || normalizedMessage.includes('bad request') || normalizedMessage.includes('invalid command')) {
        return 'bad_request_400';
    }

    if (normalizedMessage.includes('413') || normalizedMessage.includes('too large')) {
        return 'payload_too_large_413';
    }

    if (normalizedMessage.includes('unexpected data format') || normalizedMessage.includes('schema') || normalizedMessage.includes('zod')) {
        return 'parse_contract';
    }

    return 'unknown';
}

function buildSignature(job: PendingAiJobRecord, errorClass: string, normalizedMessage: string): string {
    const context = job.context;
    const stableJobKey = context.idempotencyKey
        ?? context.requestPayloadHash
        ?? context.textTranscript?.slice(0, 80)
        ?? `${context.farmId ?? 'farm'}:${context.plotId ?? 'plot'}:${job.createdAt}`;

    return [
        job.operationType,
        context.operation ?? 'unknown',
        stableJobKey,
        errorClass,
        normalizedMessage,
    ].join('|');
}

export function recordAiFailureSignature(
    job: PendingAiJobRecord,
    error: unknown,
    nowMs: number = Date.now(),
): DoomLoopDecision {
    const normalizedMessage = normalizeErrorMessage(error);
    const errorClass = classifyError(normalizedMessage);
    const signature = buildSignature(job, errorClass, normalizedMessage);
    const windowStart = nowMs - WINDOW_MS;

    const retained = (job.attemptSignatures ?? [])
        .filter(item => item.lastSeenAtMs >= windowStart && item.signature !== signature)
        .slice(-MAX_SIGNATURES);

    const existing = (job.attemptSignatures ?? [])
        .find(item => item.signature === signature && item.lastSeenAtMs >= windowStart);

    const current: PendingAiAttemptSignature = existing
        ? {
            ...existing,
            lastSeenAtMs: nowMs,
            count: existing.count + 1,
        }
        : {
            signature,
            errorClass,
            firstSeenAtMs: nowMs,
            lastSeenAtMs: nowMs,
            count: 1,
        };

    const attemptSignatures = [...retained, current].slice(-MAX_SIGNATURES);
    const isTransient = TRANSIENT_CLASSES.has(errorClass);
    const shouldStop = !isTransient && current.count >= MAX_REPEATS;

    return {
        shouldStop,
        reason: shouldStop ? `${errorClass} repeated ${current.count} times in ${WINDOW_MS / 60000} minutes` : undefined,
        signature,
        errorClass,
        attemptSignatures,
    };
}
