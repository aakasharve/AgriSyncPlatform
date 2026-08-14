/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope
 *
 * `PendingAiResultsReader` is the READ half of the fix that landed in
 * `27e55ce7` (the WRITE half — `PendingAiJobRecord.result` now holds the
 * verbatim API payload of a drained offline AI job). Before this reader,
 * nothing consumed that field: the farmer's spoken note produced a row in
 * Dexie no screen ever opened.
 *
 * These tests drive the REAL functions against a real Dexie (fake-indexeddb),
 * covering exactly the acceptance list from the task brief:
 *   - a completed job with a result appears
 *   - a reviewed one does not
 *   - a failed one does not
 *   - a completed row with NO result (a pre-`27e55ce7` row) does not appear
 *     and does not throw
 * plus `markAiResultReviewed` and `buildAiDraftForReview` (the plot-scoped
 * draft builder the reviewing surface uses to open `ManualEntry`).
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase, type PendingAiJobRecord } from '../../storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';
import {
    listUnreviewedAiResults,
    markAiResultReviewed,
    buildAiDraftForReview,
} from '../PendingAiResultsReader';
import type { CropProfile } from '../../../types';

const FROZEN_NOW_ISO = '2026-08-15T09:00:00.000Z';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // first run — nothing to delete
    }
    await resetDatabase();
}

/** Base fields shared by every seeded pendingAiJobs row in this file. */
function baseJob(overrides: Partial<PendingAiJobRecord>): Omit<PendingAiJobRecord, 'id'> {
    return {
        operationType: 'voice_parse',
        context: { farmId: 'farm-1', userId: 'user-1', operation: 'voice', plotId: 'plot-1' },
        status: 'completed',
        createdAt: '2026-08-14T18:30:00.000Z',
        updatedAt: '2026-08-14T18:31:00.000Z',
        retryCount: 0,
        ...overrides,
    };
}

const VOICE_PARSED_LOG = {
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    activityExpenses: [],
    fullTranscript: 'काल फवारणी केली',
    summary: 'Sprayed yesterday',
    questionsForUser: [],
    missingSegments: [],
    dayOutcome: 'WORK_RECORDED',
};

function cropWithPlot(cropId: string, plotId: string): CropProfile {
    return {
        id: cropId,
        name: 'Grapes',
        plots: [{ id: plotId, name: 'Plot A' }],
    } as unknown as CropProfile;
}

beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);
    await freshDb();
});

describe('listUnreviewedAiResults', () => {
    it('a completed job with a result appears', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({
            result: { operationType: 'voice_parse', receivedAtUtc: '2026-08-14T19:00:00.000Z', payload: { parsedLog: VOICE_PARSED_LOG } },
        }));

        const results = await listUnreviewedAiResults();

        expect(results.map(r => r.id)).toEqual([id]);
    });

    it('a reviewed job does not appear', async () => {
        const db = getDatabase();
        await db.pendingAiJobs.add(baseJob({
            result: {
                operationType: 'voice_parse',
                receivedAtUtc: '2026-08-14T19:00:00.000Z',
                payload: { parsedLog: VOICE_PARSED_LOG },
                reviewedAtUtc: '2026-08-14T20:00:00.000Z',
            },
        }));

        expect(await listUnreviewedAiResults()).toEqual([]);
    });

    it('a failed job does not appear, even one carrying a result-shaped field', async () => {
        const db = getDatabase();
        await db.pendingAiJobs.add(baseJob({
            status: 'failed',
            lastError: 'network blip',
        }));
        await db.pendingAiJobs.add(baseJob({
            status: 'failed_permanent',
            lastError: 'gave up',
        }));

        expect(await listUnreviewedAiResults()).toEqual([]);
    });

    it('a completed row with NO result (a pre-27e55ce7 row) does not appear and does not throw', async () => {
        const db = getDatabase();
        await db.pendingAiJobs.add(baseJob({}));

        await expect(listUnreviewedAiResults()).resolves.toEqual([]);
    });

    it('a completed job with an empty (but present) payload still appears — an unusual answer is still an answer', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({
            result: { operationType: 'voice_parse', receivedAtUtc: '2026-08-14T19:00:00.000Z', payload: {} },
        }));

        const results = await listUnreviewedAiResults();

        expect(results.map(r => r.id)).toEqual([id]);
    });
});

describe('markAiResultReviewed', () => {
    it('sets reviewedAtUtc and the job stops appearing in listUnreviewedAiResults', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({
            result: { operationType: 'voice_parse', receivedAtUtc: '2026-08-14T19:00:00.000Z', payload: { parsedLog: VOICE_PARSED_LOG } },
        }));

        await markAiResultReviewed(id);

        const row = await db.pendingAiJobs.get(id);
        expect(row?.result?.reviewedAtUtc).toBe(FROZEN_NOW_ISO);
        expect(await listUnreviewedAiResults()).toEqual([]);
    });

    it('preserves the rest of the result payload — this is a mark, not a rewrite', async () => {
        const db = getDatabase();
        const payload = { parsedLog: VOICE_PARSED_LOG, confidence: 0.87 };
        const id = await db.pendingAiJobs.add(baseJob({
            result: { operationType: 'voice_parse', receivedAtUtc: '2026-08-14T19:00:00.000Z', payload },
        }));

        await markAiResultReviewed(id);

        const row = await db.pendingAiJobs.get(id);
        expect(row?.result?.payload).toEqual(payload);
        expect(row?.result?.receivedAtUtc).toBe('2026-08-14T19:00:00.000Z');
    });

    it('is a no-op (does not throw) for a job with no result', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({ status: 'pending' }));

        await expect(markAiResultReviewed(id)).resolves.toBeUndefined();
    });

    it('is a no-op (does not throw) for a job id that does not exist', async () => {
        await expect(markAiResultReviewed(999999)).resolves.toBeUndefined();
    });
});

describe('buildAiDraftForReview', () => {
    it('voice_parse job with a resolvable plot returns a scoped context + normalized agriLog + AI provenance', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({
            context: { farmId: 'farm-1', userId: 'user-1', operation: 'voice', plotId: 'plot-1' },
            result: {
                operationType: 'voice_parse',
                receivedAtUtc: '2026-08-14T19:00:00.000Z',
                payload: { parsedLog: VOICE_PARSED_LOG, modelUsed: 'gemini-2.5-flash', promptVersion: 'v3.2', confidence: 0.9 },
            },
        }));
        const job = (await listUnreviewedAiResults()).find(r => r.id === id)!;

        const draft = buildAiDraftForReview(job, [cropWithPlot('crop-1', 'plot-1')]);

        expect(draft).not.toBeNull();
        expect(draft?.context.selection).toEqual([{
            cropId: 'crop-1',
            cropName: 'Grapes',
            selectedPlotIds: ['plot-1'],
            selectedPlotNames: ['Plot A'],
        }]);
        expect(draft?.agriLog.fullTranscript).toBe('काल फवारणी केली');
        expect(draft?.provenance.source).toBe('ai');
        expect(draft?.provenance.modelVersion).toBe('gemini-2.5-flash');
        expect(draft?.provenance.timestamp).toBe('2026-08-14T19:00:00.000Z');
    });

    it('returns null for a receipt_extract job — it is not shaped for ManualEntry and must not be faked into one', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({
            operationType: 'receipt_extract',
            context: { farmId: 'farm-1', userId: 'user-1', plotId: 'plot-1' },
            result: {
                operationType: 'receipt_extract',
                receivedAtUtc: '2026-08-14T19:00:00.000Z',
                payload: { vendorName: 'Bharat Krishi', totalAmount: 4500 },
            },
        }));
        const job = (await listUnreviewedAiResults()).find(r => r.id === id)!;

        expect(buildAiDraftForReview(job, [cropWithPlot('crop-1', 'plot-1')])).toBeNull();
    });

    it('returns null when the job plot no longer exists among the farmer\'s crops', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({
            context: { farmId: 'farm-1', userId: 'user-1', operation: 'voice', plotId: 'plot-deleted' },
            result: { operationType: 'voice_parse', receivedAtUtc: '2026-08-14T19:00:00.000Z', payload: { parsedLog: VOICE_PARSED_LOG } },
        }));
        const job = (await listUnreviewedAiResults()).find(r => r.id === id)!;

        expect(buildAiDraftForReview(job, [cropWithPlot('crop-1', 'plot-1')])).toBeNull();
    });

    it('returns null when the job context carries no plotId at all', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({
            context: { farmId: 'farm-1', userId: 'user-1', operation: 'voice' },
            result: { operationType: 'voice_parse', receivedAtUtc: '2026-08-14T19:00:00.000Z', payload: { parsedLog: VOICE_PARSED_LOG } },
        }));
        const job = (await listUnreviewedAiResults()).find(r => r.id === id)!;

        expect(buildAiDraftForReview(job, [cropWithPlot('crop-1', 'plot-1')])).toBeNull();
    });

    it('returns null for a patti_extract job — the missing sibling of the receipt_extract case above', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({
            operationType: 'patti_extract',
            context: { farmId: 'farm-1', userId: 'user-1', plotId: 'plot-1', cropName: 'Grapes' },
            result: {
                operationType: 'patti_extract',
                receivedAtUtc: '2026-08-14T19:00:00.000Z',
                payload: { rate: 42, weight: 100 },
            },
        }));
        const job = (await listUnreviewedAiResults()).find(r => r.id === id)!;

        expect(buildAiDraftForReview(job, [cropWithPlot('crop-1', 'plot-1')])).toBeNull();
    });

    // IMPORTANT 1 (fix round 1) — a completed voice_parse job whose
    // `result.payload` has no `parsedLog` key used to reach
    // `normalizeParsedLog(undefined)` and throw on `agriLog.fullTranscript`
    // the moment a farmer tapped Review. The row above ("an unusual answer is
    // still an answer") proves `listUnreviewedAiResults` still lists it; this
    // proves the BUILDER — the function `AiDraftsPage` actually calls on tap —
    // refuses cleanly instead of throwing.
    it('returns null (does not throw) for a voice_parse job whose payload has no parsedLog', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({
            context: { farmId: 'farm-1', userId: 'user-1', operation: 'voice', plotId: 'plot-1' },
            result: { operationType: 'voice_parse', receivedAtUtc: '2026-08-14T19:00:00.000Z', payload: {} },
        }));
        const job = (await listUnreviewedAiResults()).find(r => r.id === id)!;

        expect(() => buildAiDraftForReview(job, [cropWithPlot('crop-1', 'plot-1')])).not.toThrow();
        expect(buildAiDraftForReview(job, [cropWithPlot('crop-1', 'plot-1')])).toBeNull();
    });

    it('recordedDateKey prefers context.recordedAtUtc over the device-received instant', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({
            // Recorded at dusk (2026-08-13, IST) but not drained/reviewed
            // until the following morning (2026-08-14) — the whole point of
            // IMPORTANT 4: the log must land on the 13th, not the 14th.
            context: { farmId: 'farm-1', userId: 'user-1', operation: 'voice', plotId: 'plot-1', recordedAtUtc: '2026-08-13T15:00:00.000Z' },
            result: { operationType: 'voice_parse', receivedAtUtc: '2026-08-14T05:00:00.000Z', payload: { parsedLog: VOICE_PARSED_LOG } },
        }));
        const job = (await listUnreviewedAiResults()).find(r => r.id === id)!;

        const draft = buildAiDraftForReview(job, [cropWithPlot('crop-1', 'plot-1')]);

        expect(draft?.recordedDateKey).toBe('2026-08-13');
    });

    // NEW 3 (fix round 2) — the text-note case named by the review.
    // `BackendAiClient.enqueueOfflineVoiceJob`'s TEXT branch never sets
    // `context.recordedAtUtc` (only the audio branch carries a MediaRecorder
    // instant), so falling back straight to `receivedAtUtc` (the DRAIN
    // instant, stamped by `AiJobWorker` whenever connectivity returns —
    // possibly hours or days later) reproduced the exact defect Important 4
    // was meant to close. `job.createdAt` — stamped at ENQUEUE time, i.e.
    // immediately after the farmer finished speaking/typing, for both text
    // and audio — must win instead.
    it('recordedDateKey falls back to job.createdAt (not receivedAtUtc) for a text note with no recordedAtUtc', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({
            // Typed at dusk (2026-08-13, IST)...
            createdAt: '2026-08-13T15:00:00.000Z',
            context: { farmId: 'farm-1', userId: 'user-1', operation: 'text', plotId: 'plot-1', textTranscript: 'काल फवारणी केली' },
            // ...but not drained until the following morning (2026-08-14).
            result: { operationType: 'voice_parse', receivedAtUtc: '2026-08-14T05:00:00.000Z', payload: { parsedLog: VOICE_PARSED_LOG } },
        }));
        const job = (await listUnreviewedAiResults()).find(r => r.id === id)!;

        const draft = buildAiDraftForReview(job, [cropWithPlot('crop-1', 'plot-1')]);

        expect(draft?.recordedDateKey).toBe('2026-08-13');
    });

    it('recordedDateKey falls back to receivedAtUtc only if createdAt is also unusable (defensive, last resort)', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(baseJob({
            context: { farmId: 'farm-1', userId: 'user-1', operation: 'voice', plotId: 'plot-1' },
            result: { operationType: 'voice_parse', receivedAtUtc: '2026-08-14T05:00:00.000Z', payload: { parsedLog: VOICE_PARSED_LOG } },
        }));
        // `createdAt` is a required field on every real row; force it absent
        // here only to prove the last-resort branch of the fallback chain is
        // reachable and correct, not merely dead code.
        await db.pendingAiJobs.update(id, { createdAt: undefined as unknown as string });
        const job = (await listUnreviewedAiResults()).find(r => r.id === id)!;

        const draft = buildAiDraftForReview(job, [cropWithPlot('crop-1', 'plot-1')]);

        expect(draft?.recordedDateKey).toBe('2026-08-14');
    });
});
