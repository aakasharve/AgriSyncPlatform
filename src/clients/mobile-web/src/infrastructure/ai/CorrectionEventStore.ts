import type { AgriLogResponse } from '../../types';
import type { LogProvenance } from '../../domain/ai/LogProvenance';
import type { CorrectionEvent, CorrectionType } from '../../domain/ai/contracts/CorrectionEvent';
import { withCorrectionBucket } from '../../domain/ai/contracts/CorrectionEvent';
import { getDatabase } from '../storage/DexieDatabase';

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
