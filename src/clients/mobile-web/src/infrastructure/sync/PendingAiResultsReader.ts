/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * READS what `AiJobWorker` writes and NOTHING ELSE reads.
 *
 * `27e55ce7` fixed the write half: `PendingAiJobRecord.result` now holds the
 * verbatim API payload of a drained offline AI job. Until this module, nothing
 * in the app read that field — the farmer's spoken note produced a row in
 * Dexie no screen ever opened. This is the other half: list the drafts still
 * waiting on the farmer, and let the reviewing surface mark one reviewed once
 * he has actually acted on it (`markAiResultReviewed`) — never merely because
 * it was displayed.
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope
 */
import { getDatabase, type PendingAiJobRecord, type PendingAiJobResult } from '../storage/DexieDatabase';
import { systemClock } from '../../core/domain/services/Clock';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { normalizeParsedLog } from '../ai/BackendAiClient.helpers';
import type { AgriLogResponse, CropProfile, FarmContext } from '../../types';
import type { LogProvenance } from '../../domain/ai/LogProvenance';

/** A `PendingAiJobRecord` guaranteed (by `listUnreviewedAiResults`) to carry a persisted id and an unreviewed result. */
export type UnreviewedAiResult = PendingAiJobRecord & { id: number; result: PendingAiJobResult };

/**
 * Every job whose answer the farmer has not yet acted on.
 *
 * Deliberately narrow, per the offline-queue's own honesty rules:
 *   - `status === 'completed'` only. A `failed_permanent` job has its own
 *     surface already (the doom-loop toast) — it is not a draft, it is a
 *     failure, and listing it here as something to "review" would misstate
 *     what happened.
 *   - `result` must be present. Rows written before `27e55ce7` completed
 *     with no `result` (the field did not exist yet); they are silently
 *     excluded rather than thrown on — that gap is already-known, already-
 *     disclosed history, not a new defect for this reader to surface.
 *   - `result.reviewedAtUtc` must be absent. Once set, the farmer has acted
 *     (confirmed or explicitly discarded) and the draft stops resurfacing.
 */
export async function listUnreviewedAiResults(): Promise<UnreviewedAiResult[]> {
    const db = getDatabase();
    const completed = await db.pendingAiJobs.where('status').equals('completed').toArray();

    return completed.filter((job): job is UnreviewedAiResult =>
        job.id !== undefined
        && job.result !== undefined
        && job.result.reviewedAtUtc === undefined);
}

/**
 * Marks a job's result reviewed. Callers MUST only call this once the farmer
 * has actually acted — confirmed the draft into a log, or explicitly
 * discarded it — never merely because it was shown to him (a glance is not a
 * decision, and treating it as one silently loses the note).
 *
 * No-ops (does not throw) when the job or its result no longer exists, so a
 * stale id from a page that raced a delete elsewhere degrades quietly.
 */
export async function markAiResultReviewed(jobId: number): Promise<void> {
    const db = getDatabase();
    const job = await db.pendingAiJobs.get(jobId);
    if (!job || !job.result) {
        return;
    }

    await db.pendingAiJobs.update(jobId, {
        result: {
            ...job.result,
            reviewedAtUtc: systemClock.nowISO(),
        },
    });
}

/** What the reviewing surface needs to open a draft inside `ManualEntry`. */
export interface AiDraftForReview {
    context: FarmContext;
    agriLog: AgriLogResponse;
    provenance: LogProvenance;
    /**
     * IMPORTANT 4 (fix round 1) — the day this note actually belongs to, NOT
     * the day the farmer happens to open the review screen. Sourced from
     * `job.context.recordedAtUtc` (the MediaRecorder capture instant) when
     * present, else `job.result.receivedAtUtc` (when the device processed
     * it) — both are closer to the truth than "today" for a note recorded at
     * dusk and reviewed the next morning. Threaded into `ManualEntry` via its
     * OPTIONAL `recordedDateKey` prop; the live path never passes this prop,
     * so its own default (`getDateKey()` = today) is untouched.
     */
    recordedDateKey: string;
}

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = source?.[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(source: Record<string, unknown> | undefined, key: string): number | undefined {
    const value = source?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(source: Record<string, unknown> | undefined, key: string): boolean | undefined {
    const value = source?.[key];
    return typeof value === 'boolean' ? value : undefined;
}

/**
 * Builds the `ManualEntry` props for one draft, or `null` when this job is
 * not reviewable through `ManualEntry` today:
 *
 *   - only `voice_parse` jobs carry a `parsedLog` shaped for the
 *     AgriLogResponse schema. `receipt_extract` / `patti_extract` payloads
 *     are a different shape entirely (vendor/amount/items) — normalizing
 *     them through the voice schema would not recover real fields, it would
 *     fabricate an empty log, which is exactly what this codebase's honesty
 *     rules forbid. Those operation types get their own surface in a later
 *     task; `listUnreviewedAiResults` still returns them so nothing is
 *     silently dropped from the underlying count.
 *   - the job's `context.plotId` must resolve to a plot the farmer still
 *     has. A plot deleted after the note was recorded leaves no context to
 *     open the draft into.
 *   - `payload.parsedLog` must actually be present and be an object.
 *     IMPORTANT 1 (fix round 1) — a `voice_parse` job whose stored payload
 *     has no `parsedLog` key at all (a degenerate/empty `result.payload`)
 *     used to reach `normalizeParsedLog(undefined)`, which returns
 *     `undefined` typed as `AgriLogResponse` (`normalizeDriftedParsedLog`'s
 *     own `!raw` guard), and the very next line's `agriLog.fullTranscript`
 *     threw on a farmer's tap. There is nothing to recover here — refusing
 *     (returning `null`, same as the receipt/patti case) is honest; a form
 *     rendered from nothing would not be.
 */
export function buildAiDraftForReview(job: UnreviewedAiResult, crops: CropProfile[]): AiDraftForReview | null {
    if (job.operationType !== 'voice_parse') {
        return null;
    }

    const plotId = job.context.plotId;
    const crop = plotId ? crops.find(candidate => candidate.plots.some(plot => plot.id === plotId)) : undefined;
    const plot = crop?.plots.find(candidate => candidate.id === plotId);
    if (!crop || !plot) {
        return null;
    }

    const payload = job.result.payload as Record<string, unknown> | undefined;
    const rawParsedLog = payload && typeof payload === 'object' ? payload['parsedLog'] : undefined;
    if (!rawParsedLog || typeof rawParsedLog !== 'object') {
        return null;
    }
    const agriLog = normalizeParsedLog(rawParsedLog);

    const recordedDateKey = getDateKey(job.context.recordedAtUtc ?? job.result.receivedAtUtc);

    const context: FarmContext = {
        selection: [{
            cropId: crop.id,
            cropName: crop.name,
            selectedPlotIds: [plotId as string],
            selectedPlotNames: [plot.name],
        }],
    };

    const rawTranscript = typeof agriLog.fullTranscript === 'string'
        ? agriLog.fullTranscript
        : job.context.textTranscript;

    const provenance: LogProvenance = {
        source: 'ai',
        model: readString(payload, 'modelUsed'),
        modelVersion: readString(payload, 'modelUsed'),
        providerUsed: readString(payload, 'providerUsed'),
        fallbackUsed: readBoolean(payload, 'fallbackUsed'),
        promptVersion: readString(payload, 'promptVersion'),
        promptContentHash: readString(payload, 'promptContentHash'),
        appVersion: readString(payload, 'appVersion'),
        sourceAiJobId: readString(payload, 'sourceAiJobId'),
        rawTranscript,
        confidenceScore: readNumber(payload, 'confidence'),
        processingTimeMs: readNumber(payload, 'latencyMs'),
        timestamp: job.result.receivedAtUtc,
    };

    return { context, agriLog, provenance, recordedDateKey };
}
