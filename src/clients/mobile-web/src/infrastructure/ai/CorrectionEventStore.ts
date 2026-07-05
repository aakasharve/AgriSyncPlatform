import type { AgriLogResponse } from '../../types';
import type { LogProvenance } from '../../domain/ai/LogProvenance';
import type { CorrectionEvent, CorrectionType } from '../../domain/ai/contracts/CorrectionEvent';
import { withCorrectionBucket } from '../../domain/ai/contracts/CorrectionEvent';
import { getDatabase } from '../storage/DexieDatabase';
import { resolveApiBaseUrl } from '../api/transport';
import { getAuthSession } from '../storage/AuthTokenStore';

const BUCKET_FIELDS = [
    'cropActivities',
    'irrigation',
    'inputs',
    'labour',
    'machinery',
    'activityExpenses',
    'observations',
    'plannedTasks',
] as const;

type BucketField = typeof BUCKET_FIELDS[number];
type ComparableDraft = Record<string, unknown> & { fullTranscript?: string };

function readBucketValue(log: ComparableDraft, field: BucketField): unknown[] {
    const value = log[field];
    return Array.isArray(value) ? value : [];
}

function stableJson(value: unknown): string {
    return JSON.stringify(value ?? null);
}

function classifyCorrection(aiValue: unknown[], userValue: unknown[]): CorrectionType {
    if (aiValue.length === 0 && userValue.length > 0) {
        return 'missing_field';
    }

    if (aiValue.length > 0 && userValue.length === 0) {
        return 'hallucinated_field';
    }

    return 'wrong_value';
}

function createId(): string {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `corr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildAiCorrectionEvents(params: {
    aiDraft: ComparableDraft | Partial<AgriLogResponse>;
    userDraft: ComparableDraft | Partial<AgriLogResponse>;
    provenance: LogProvenance;
}): CorrectionEvent[] {
    if (params.provenance.source !== 'ai') {
        return [];
    }

    const extractionId = [
        params.provenance.providerUsed ?? 'provider',
        params.provenance.model ?? 'model',
        params.provenance.timestamp,
    ].join(':');
    const rawTranscript = params.provenance.rawTranscript
        ?? (params.userDraft as ComparableDraft).fullTranscript
        ?? (params.aiDraft as ComparableDraft).fullTranscript
        ?? '';
    const promptVersion = params.provenance.promptVersion ?? 'unknown';
    const timestamp = new Date().toISOString();

    return BUCKET_FIELDS.flatMap(field => {
        const aiValue = readBucketValue(params.aiDraft as ComparableDraft, field);
        const userValue = readBucketValue(params.userDraft as ComparableDraft, field);

        if (stableJson(aiValue) === stableJson(userValue)) {
            return [];
        }

        return withCorrectionBucket({
            id: createId(),
            extractionId,
            timestamp,
            fieldPath: field,
            aiValue,
            userValue,
            rawTranscript,
            promptVersion,
            correctionType: classifyCorrection(aiValue, userValue),
        });
    });
}

export async function persistAiCorrectionEvents(events: CorrectionEvent[]): Promise<void> {
    if (events.length === 0) {
        return;
    }

    await getDatabase().aiCorrectionEvents.bulkPut(events.map(withCorrectionBucket));
}

/**
 * POST the coarse whole-blob correction to the server endpoint
 * `POST /shramsafal/corrections` — best-effort, fire-and-forget.
 *
 * - Fires ONLY when aiDraft and userDraft actually differ (re-uses
 *   buildAiCorrectionEvents as the diff gate: if it returns [] there is
 *   nothing to report).
 * - Does NOT block or throw into the caller; failures are swallowed with
 *   a console.warn (matching the existing persist `.catch` pattern).
 * - spec: ai-intelligence-plan-2026-06-25 (C11 W1.P4.T1)
 */
export function postAiCorrectionBlob(params: {
    aiDraft: ComparableDraft | Partial<AgriLogResponse>;
    userDraft: ComparableDraft | Partial<AgriLogResponse>;
    provenance: LogProvenance;
}): void {
    // Diff gate: mirror buildAiCorrectionEvents — if no bucket changed,
    // skip the POST entirely (no-diff → no network call).
    const events = buildAiCorrectionEvents(params);
    if (events.length === 0) {
        return;
    }

    const { aiDraft, userDraft, provenance } = params;

    // OriginalParseId: prefer the backend AiJob id from provenance if
    // available; otherwise generate a client-side UUID for the session.
    const originalParseId: string =
        provenance.sourceAiJobId && isValidUuid(provenance.sourceAiJobId)
            ? provenance.sourceAiJobId
            : createId();

    const body = JSON.stringify({
        OriginalParseId: originalParseId,
        OriginalParseRaw: JSON.stringify(aiDraft),
        CorrectedParse: JSON.stringify(userDraft),
        PromptVersion: provenance.promptVersion ?? 'unknown',
        // 'mr-IN' is the primary app locale; kept null-safe for test
        // environments where no locale override is available.
        Locale: 'mr-IN',
        // CorrectionTrigger.EditUI — the farmer manually edited the AI
        // draft via the ManualEntry form (server enum value 0).
        Trigger: 0,
    });

    const doPost = async (): Promise<void> => {
        const baseUrl = resolveApiBaseUrl();
        const session = getAuthSession();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (session?.accessToken) {
            headers.Authorization = `Bearer ${session.accessToken}`;
        }
        const response = await fetch(`${baseUrl}/shramsafal/corrections`, {
            method: 'POST',
            headers,
            body,
        });
        if (!response.ok) {
            console.warn(
                '[AI corrections bridge] Server rejected correction POST.',
                response.status,
                response.statusText,
            );
        }
    };

    // Fire-and-forget: swallow all errors so the save flow is never
    // interrupted by a network issue or offline state. This matches the
    // existing persistAiCorrectionEvents `.catch` pattern. W1 does NOT
    // enqueue in the mutation outbox (that is the W2 follow-up).
    void doPost().catch(err =>
        console.warn('[AI corrections bridge] Failed to POST correction blob.', err),
    );
}

function isValidUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
