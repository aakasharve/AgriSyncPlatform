import type { AgriLogResponse } from '../../types';
import type { LogProvenance } from '../../domain/ai/LogProvenance';
import type { CorrectionEvent, CorrectionType } from '../../domain/ai/contracts/CorrectionEvent';
import { withCorrectionBucket } from '../../domain/ai/contracts/CorrectionEvent';
import { stripTranscriptText } from '../../domain/ai/contracts/transcriptRedaction';
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
    const promptVersion = params.provenance.promptVersion ?? 'unknown';
    const timestamp = new Date().toISOString();

    return BUCKET_FIELDS.flatMap(field => {
        // §P0.4 — strip verbatim speech BEFORE the diff, not after. Doing it
        // before means the comparison is purely structural: a "correction"
        // that only changed which words the AI attributed to a field is not
        // a correction of anything the farmer can see, and no longer emits
        // an event carrying those words.
        const aiValue = stripTranscriptText(readBucketValue(params.aiDraft as ComparableDraft, field));
        const userValue = stripTranscriptText(readBucketValue(params.userDraft as ComparableDraft, field));

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
            // Lineage, not speech. `sourceAiJobId` is the originating
            // operation reference; it is carried as-is or not at all.
            sourceAiJobId: params.provenance.sourceAiJobId,
            modelVersion: params.provenance.modelVersion ?? params.provenance.model,
            promptVersion,
            promptContentHash: params.provenance.promptContentHash,
            correctionType: classifyCorrection(aiValue, userValue),
        });
    });
}

export async function persistAiCorrectionEvents(events: CorrectionEvent[]): Promise<void> {
    if (events.length === 0) {
        return;
    }

    // §P0.4 — redact at the persistence boundary, not only at the build site.
    // `buildAiCorrectionEvents` already strips, but this is the one function
    // that writes to IndexedDB, so any other caller is covered too. The strip
    // is idempotent, so doing it twice costs nothing and guarantees no
    // transcript key can reach unencrypted local storage.
    await getDatabase().aiCorrectionEvents.bulkPut(
        events.map(event => stripTranscriptText(withCorrectionBucket(event))),
    );
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

    // OriginalParseId: the id of the backend AiJob this parse came from.
    //
    // §P0.4 — it used to mint a FRESH RANDOM UUID whenever `sourceAiJobId`
    // was absent or not a UUID. That id matched no AiJob, so
    // `GoldenSetFeedbackWorker` — which joins `AiJobs.Id == OriginalParseId`
    // — silently skipped the row, while the column still looked like a
    // genuine link. `null` is the honest answer: the link is unknown, and
    // it now says so instead of inventing one.
    const originalParseId: string | null =
        provenance.sourceAiJobId && isValidUuid(provenance.sourceAiJobId)
            ? provenance.sourceAiJobId
            : null;

    const body = JSON.stringify({
        OriginalParseId: originalParseId,
        // §P0.4 — the server gets the STRUCTURED draft only. `fullTranscript`,
        // `english`, `sourceText` and friends rode into `ssf.correction_events`
        // unredacted; the locked ruling says no server copy of the transcript
        // exists, so now none does. The server re-applies the same redaction
        // on the way in — this is the near end of a belt-and-braces pair, so a
        // stale client cannot re-open the hole.
        OriginalParseRaw: JSON.stringify(stripTranscriptText(aiDraft)),
        CorrectedParse: JSON.stringify(stripTranscriptText(userDraft)),
        PromptVersion: provenance.promptVersion ?? 'unknown',
        // The only tamper-evident prompt identifier; previously discarded.
        PromptContentHash: provenance.promptContentHash ?? null,
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
