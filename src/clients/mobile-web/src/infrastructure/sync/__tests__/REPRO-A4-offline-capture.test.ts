// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 0 RUNTIME REPRODUCTION — PROBE A4 (offline capture).
 * Spec: docs/superpowers/specs/2026-08-14-FOUNDER-DIRECTION-after-phase-A.md §2, §6.
 *
 * EVIDENCE ONLY. Nothing in production code is touched by this file. Every test
 * below drives the REAL worker / repository / reconciler against a real Dexie
 * (fake-indexeddb) and asserts what the app can actually reach afterwards.
 *
 * Each claim block opens with a SANITY assertion that is known-true, so a green
 * run cannot be mistaken for a working feature: if the harness silently failed
 * to execute the production code, the sanity assertion fails first.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
    parseVoiceLogMock,
    parseTextLogMock,
    extractReceiptMock,
    extractPattiMock,
    pullChangesMock,
    pushBatchMock,
    uploadAttachmentFileMock,
    getAttachmentMetadataMock,
} = vi.hoisted(() => ({
    parseVoiceLogMock: vi.fn(),
    parseTextLogMock: vi.fn(),
    extractReceiptMock: vi.fn(),
    extractPattiMock: vi.fn(),
    pullChangesMock: vi.fn(),
    pushBatchMock: vi.fn(),
    uploadAttachmentFileMock: vi.fn(),
    getAttachmentMetadataMock: vi.fn(),
}));

vi.mock('../../api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../api/AgriSyncClient')>('../../api/AgriSyncClient');
    return {
        ...actual,
        agriSyncClient: {
            parseVoiceLog: parseVoiceLogMock,
            parseTextLog: parseTextLogMock,
            extractReceipt: extractReceiptMock,
            extractPatti: extractPattiMock,
            pullSyncChanges: pullChangesMock,
            pushSyncBatch: pushBatchMock,
            uploadAttachmentFile: uploadAttachmentFileMock,
            getAttachmentMetadata: getAttachmentMetadataMock,
        },
    };
});

vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'user-1', accessToken: 'tok', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));

// Opportunistic retained-tier archive is unrelated to the claim under test and
// reaches for WebCrypto; stub it so a crypto failure cannot masquerade as the
// defect. AiJobWorker.ts:104 is the only call site.
vi.mock('../../voice/VoiceClipRetention', () => ({
    archiveToRetainedTierIfConsented: vi.fn().mockResolvedValue(undefined),
}));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import type { SyncPullResponse, DailyLogDto } from '../../api/AgriSyncClient';
import { AiJobWorker } from '../AiJobWorker';
import { attachmentUploadWorker } from '../AttachmentUploadWorker';
import { resetFailedUploadsToPending } from '../UploadQueueRetry';
import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { DexieLogsRepository } from '../../storage/DexieLogsRepository';

const EMPTY_PULL: SyncPullResponse = {
    serverTimeUtc: '2026-08-14T06:00:00.000Z',
    nextCursorUtc: '2026-08-14T06:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [],
    costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [],
    plannedActivities: [], auditEvents: [],
};

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // first run — nothing to delete
    }
    await resetDatabase();
}

/**
 * Sweeps EVERY Dexie table for a marker string. This is the "anywhere a UI
 * could read it" test — it does not privilege any particular store, so it
 * cannot be accused of looking in the wrong place.
 */
async function tablesContaining(marker: string): Promise<string[]> {
    const db = getDatabase();
    const hits: string[] = [];
    for (const table of db.tables) {
        let rows: unknown[];
        try {
            rows = await table.toArray();
        } catch {
            continue;
        }
        for (const row of rows) {
            let serialized = '';
            try {
                serialized = JSON.stringify(row) ?? '';
            } catch {
                serialized = String(row);
            }
            if (serialized.includes(marker)) {
                hits.push(table.name);
                break;
            }
        }
    }
    return hits;
}

beforeEach(async () => {
    vi.clearAllMocks();
    pullChangesMock.mockResolvedValue(EMPTY_PULL);
    pushBatchMock.mockResolvedValue({ results: [] });
    await freshDb();
});

afterEach(() => {
    attachmentUploadWorker.stop();
});

// ===========================================================================
// CLAIM A4.1 — offline voice capture round-trips to nothing
// ===========================================================================

describe('A4.1 — a drained offline voice job leaves the farmer nothing to see', () => {
    const DRAFT_MARKER = 'A4-1-PARSED-DRAFT-द्राक्ष-फवारणी';
    const JOB_SENTINEL = 'A4-1-SWEEP-SENTINEL';

    async function seedQueuedVoiceJob(): Promise<number> {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add({
            operationType: 'voice_parse',
            inputBlob: new Blob(['fake-audio-bytes'], { type: 'audio/webm' }),
            inputMimeType: 'audio/webm',
            context: {
                farmId: 'farm-1',
                userId: 'user-1',
                operation: 'voice',
                idempotencyKey: 'clip-a41',
                requestPayloadHash: JOB_SENTINEL,
                parseContext: {},
            },
            status: 'pending',
            createdAt: '2026-08-13T18:30:00.000Z',
            updatedAt: '2026-08-13T18:30:00.000Z',
            retryCount: 0,
        });

        await db.voiceClips.add({
            id: 'clip-a41',
            farmId: 'farm-1',
            pendingAiJobId: id,
            recordedAtUtc: '2026-08-13T18:30:00.000Z',
            mimeType: 'audio/webm',
            sizeBytes: 16,
            status: 'queued',
            retentionPolicy: 'processing_30d',
            createdAt: '2026-08-13T18:30:00.000Z',
            updatedAt: '2026-08-13T18:30:00.000Z',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        return id;
    }

    it('SANITY — the worker really runs, really calls the server, and really completes the job', async () => {
        parseVoiceLogMock.mockResolvedValue({
            success: true,
            parsedLog: { activity: DRAFT_MARKER, quantity: 200, unit: 'लिटर' },
            confidence: 0.92,
        });

        const jobId = await seedQueuedVoiceJob();
        await AiJobWorker.run();

        // real production code executed
        expect(parseVoiceLogMock).toHaveBeenCalledTimes(1);
        // the server answered with a draft
        await expect(parseVoiceLogMock.mock.results[0].value).resolves.toMatchObject({
            parsedLog: { activity: DRAFT_MARKER },
        });
        // the job is marked done
        expect((await getDatabase().pendingAiJobs.get(jobId))?.status).toBe('completed');
        // and the sweep itself works — it finds a value that IS in Dexie
        expect(await tablesContaining(JOB_SENTINEL)).toContain('pendingAiJobs');
    });

    it('the parsed draft is reachable somewhere the app can read it', async () => {
        parseVoiceLogMock.mockResolvedValue({
            success: true,
            parsedLog: { activity: DRAFT_MARKER, quantity: 200, unit: 'लिटर' },
            confidence: 0.92,
        });

        const jobId = await seedQueuedVoiceJob();
        await AiJobWorker.run();

        expect((await getDatabase().pendingAiJobs.get(jobId))?.status).toBe('completed');

        // THE CLAIM: after a *successful* drain, the parsed draft must exist
        // somewhere on the device. Sweep every table.
        const hits = await tablesContaining(DRAFT_MARKER);
        expect(hits).not.toEqual([]);
    });

    it('the queued voice clip at least records that a result arrived', async () => {
        parseVoiceLogMock.mockResolvedValue({
            success: true,
            parsedLog: { activity: DRAFT_MARKER },
            confidence: 0.92,
        });

        await seedQueuedVoiceJob();
        await AiJobWorker.run();

        const clip = await getDatabase().voiceClips.get('clip-a41');
        // SANITY: the clip status advanced, so we are reading the right row.
        expect(clip?.status).toBe('parsed');

        // THE CLAIM: 'parsed' should mean the parse is retrievable, not merely
        // that a network call returned 200.
        expect(JSON.stringify(clip ?? {})).toContain(DRAFT_MARKER);
    });

    it('a receipt extraction drained offline is reachable too', async () => {
        const RECEIPT_MARKER = 'A4-1-RECEIPT-VENDOR-भारत-कृषी';
        extractReceiptMock.mockResolvedValue({
            vendorName: RECEIPT_MARKER,
            totalAmount: 4500,
        });

        const db = getDatabase();
        const jobId = await db.pendingAiJobs.add({
            operationType: 'receipt_extract',
            inputBlob: new Blob(['fake-jpeg'], { type: 'image/jpeg' }),
            inputMimeType: 'image/jpeg',
            context: { farmId: 'farm-1', userId: 'user-1', idempotencyKey: 'receipt-a41' },
            status: 'pending',
            createdAt: '2026-08-13T18:30:00.000Z',
            updatedAt: '2026-08-13T18:30:00.000Z',
            retryCount: 0,
        });

        await AiJobWorker.run();

        // SANITY
        expect(extractReceiptMock).toHaveBeenCalledTimes(1);
        expect((await db.pendingAiJobs.get(jobId))?.status).toBe('completed');

        expect(await tablesContaining(RECEIPT_MARKER)).not.toEqual([]);
    });
});

// ===========================================================================
// CLAIM A4.2 — deleted logs resurrect
// ===========================================================================

describe('A4.2 — a locally deleted log survives a sync pull', () => {
    const LOG_ID = 'a4200000-0000-4000-8000-000000000001';

    function logDto(modifiedAtUtc = '2026-08-14T05:00:00.000Z'): DailyLogDto {
        return {
            id: LOG_ID,
            farmId: 'farm-1',
            plotId: null,
            cropCycleId: null,
            operatorUserId: 'user-1',
            logDate: '2026-08-14',
            createdAtUtc: '2026-08-14T05:00:00.000Z',
            modifiedAtUtc,
            tasks: [],
            verificationEvents: [],
            scope: 'Farm',
            plotIds: [],
        };
    }

    function pullWith(dto: DailyLogDto): SyncPullResponse {
        return { ...EMPTY_PULL, dailyLogs: [dto] };
    }

    it('SANITY — the pull really lands the log, and the real delete really soft-deletes it', async () => {
        pullChangesMock.mockResolvedValue(pullWith(logDto()));
        await backgroundSyncWorker.triggerNow();

        const db = getDatabase();
        expect(await db.logs.get(LOG_ID)).toBeDefined();
        expect((await db.logs.get(LOG_ID))?.serverModifiedAtUtc).toBe('2026-08-14T05:00:00.000Z');

        const repo = DexieLogsRepository.getInstance();
        await repo.delete(LOG_ID, 'user-1', 'चुकीची नोंद');

        expect((await repo.getById(LOG_ID))?.deletion).toBeDefined();
        expect(await repo.getAll()).toEqual([]);
        expect((await db.logs.get(LOG_ID))?.isDeleted).toBe(1);
    });

    it('EVIDENCE — the deletion is written only to db.outbox, and nothing drains it', async () => {
        pullChangesMock.mockResolvedValue(pullWith(logDto()));
        await backgroundSyncWorker.triggerNow();

        const db = getDatabase();
        await DexieLogsRepository.getInstance().delete(LOG_ID, 'user-1', 'चुकीची नोंद');

        // the delete intent exists — in the outbox
        const outboxRows = await db.outbox.where('status').equals('PENDING').toArray();
        expect(outboxRows.map(r => r.action)).toContain('DELETE_LOG');

        // and nowhere the push path can see it
        expect(await db.mutationQueue.count()).toBe(0);

        // run the real push cycle
        pushBatchMock.mockClear();
        await backgroundSyncWorker.triggerNow();

        expect(pushBatchMock).not.toHaveBeenCalled();
        const stillPending = await db.outbox.where('status').equals('PENDING').toArray();
        expect(stillPending.map(r => r.action)).toContain('DELETE_LOG');
    });

    it('REGRESSION GUARD — the delete PRESERVES serverModifiedAtUtc, keeping the freshness guard armed', async () => {
        // WHAT THIS TEST USED TO ASSERT, AND WHY IT CHANGED.
        //
        // As written in Phase 0 this was an EVIDENCE test: it asserted
        // `serverModifiedAtUtc` came back UNDEFINED, documenting that `delete()`
        // built a fresh record via `toRecord` and dropped the sync watermark
        // that `save()` deliberately preserves — which is what disarmed the
        // freshness guard and let the deleted log resurrect on the next pull.
        //
        // P0.5 fixed that (`toRecordPreservingWatermark`), so the old assertion
        // now asserts a defect that no longer exists. It is inverted rather than
        // deleted: the same line that proved the bug now guards the fix.
        pullChangesMock.mockResolvedValue(pullWith(logDto()));
        await backgroundSyncWorker.triggerNow();

        const db = getDatabase();
        expect((await db.logs.get(LOG_ID))?.serverModifiedAtUtc).toBe('2026-08-14T05:00:00.000Z');

        await DexieLogsRepository.getInstance().delete(LOG_ID, 'user-1', 'चुकीची नोंद');

        expect((await db.logs.get(LOG_ID))?.serverModifiedAtUtc).toBe('2026-08-14T05:00:00.000Z');
    });

    it('THE CLAIM — the log stays deleted after the next pull', async () => {
        pullChangesMock.mockResolvedValue(pullWith(logDto()));
        await backgroundSyncWorker.triggerNow();

        const repo = DexieLogsRepository.getInstance();
        await repo.delete(LOG_ID, 'user-1', 'चुकीची नोंद');
        expect(await repo.getAll()).toEqual([]); // sanity: gone before the pull

        // Next morning. The server never heard about the deletion, so it sends
        // the same log back, unchanged.
        pullChangesMock.mockResolvedValue(pullWith(logDto()));
        await backgroundSyncWorker.triggerNow();

        const after = await repo.getById(LOG_ID);
        expect(after?.deletion).toBeDefined();
        expect(await repo.getAll()).toEqual([]);
    });
});

// ===========================================================================
// CLAIM A4.3 — 'uploading' / 'processing' are unreachable terminal wedges
// ===========================================================================

describe("A4.3 — a row left in 'uploading' by a killed app", () => {
    const ATTACHMENT_ID = 'att-a43';

    async function seedKilledMidUpload() {
        const db = getDatabase();
        await db.attachments.add({
            id: ATTACHMENT_ID,
            farmId: 'farm-1',
            localPath: `/tmp/${ATTACHMENT_ID}.jpg`,
            originalFileName: `${ATTACHMENT_ID}.jpg`,
            mimeType: 'image/jpeg',
            sizeBytes: 2048,
            status: 'uploading',
            createdAt: '2026-08-13T18:00:00.000Z',
            updatedAt: '2026-08-13T18:00:00.000Z',
            retryCount: 1,
        });
        await db.uploadQueue.add({
            attachmentId: ATTACHMENT_ID,
            status: 'uploading',
            retryCount: 1,
            lastAttemptAt: '2026-08-13T18:00:00.000Z',
            nextAttemptAt: undefined,
            createdAt: '2026-08-13T18:00:00.000Z',
            updatedAt: '2026-08-13T18:00:00.000Z',
        });
    }

    async function queueRow() {
        return getDatabase().uploadQueue.where('attachmentId').equals(ATTACHMENT_ID).first();
    }

    it('SANITY — the wedged row exists and the upload worker really runs a cycle', async () => {
        await seedKilledMidUpload();
        expect((await queueRow())?.status).toBe('uploading');

        // A healthy row proves the worker cycle is live in this harness.
        const db = getDatabase();
        await db.attachments.add({
            id: 'att-healthy', farmId: 'farm-1', localPath: '/tmp/h.jpg',
            originalFileName: 'h.jpg', mimeType: 'image/jpeg', sizeBytes: 10,
            status: 'pending', createdAt: '2026-08-13T18:00:00.000Z',
            updatedAt: '2026-08-13T18:00:00.000Z', retryCount: 0,
        });
        await db.uploadQueue.add({
            attachmentId: 'att-healthy', status: 'pending', retryCount: 0,
            createdAt: '2026-08-13T18:00:00.000Z', updatedAt: '2026-08-13T18:00:00.000Z',
        });

        await attachmentUploadWorker.triggerNow();

        const healthy = await db.uploadQueue.where('attachmentId').equals('att-healthy').first();
        expect(healthy?.status).not.toBe('pending'); // the worker touched it
    });

    it('REGRESSION GUARD — the narrow-scoped retries still refuse it, and only a worker cycle reclaims it', async () => {
        // WHAT THIS TEST USED TO ASSERT, AND WHY IT CHANGED.
        //
        // As written in Phase 0 this was an EVIDENCE test asserting that after
        // ALL FOUR recovery paths the row was still `uploading` — the wedge.
        // P0.7 gave the wedge an owner, so paths 3 and 4 now reclaim it and the
        // old assertion asserts a defect that no longer exists.
        //
        // It is inverted rather than deleted, and it still earns its place,
        // because the two halves it now pins are the two the fix could get
        // wrong in opposite directions:
        //
        //   1. `UploadQueueRetry` and "Retry All" must STILL refuse it. Their
        //      `failed`-only scope is deliberate — they fire on a farmer's tap,
        //      when a worker may be mid-upload, so they must never be able to
        //      yank a live row. Widening them is the tempting wrong fix.
        //   2. A worker cycle MUST reclaim it, because that is the only moment
        //      the worker demonstrably holds nothing.
        await seedKilledMidUpload();

        // 1. the honesty-backstop retry (UploadQueueRetry.ts) — still 0, by design
        expect(await resetFailedUploadsToPending()).toBe(0);
        // 2. the drawer's "Retry All" (BackgroundSyncWorker.retryAllFailed) — still 0
        expect((await backgroundSyncWorker.retryAllFailed()).uploads).toBe(0);
        // ...and the row is untouched by either of them
        expect((await queueRow())?.status).toBe('uploading');

        // 3. a worker cycle — THIS is the owner P0.7 added
        await attachmentUploadWorker.triggerNow();

        expect((await queueRow())?.status).not.toBe('uploading');
    });

    it('EVIDENCE — the wedged row is still counted as pending work forever', async () => {
        await seedKilledMidUpload();
        const { readSyncEvidence } = await import('../../storage/SyncStatusService');
        const { evidence } = await readSyncEvidence();
        expect(evidence.pendingUploads).toBe(1);
    });

    it('PARTIAL MITIGATION — a pull that says the server ALREADY has the file does clear it', async () => {
        await seedKilledMidUpload();

        // The one narrow escape hatch: attachmentsReconciler.ts:48-66 flips a
        // queue row to 'completed' when a pulled AttachmentDto reports the
        // server holds it. Only reachable when the bytes landed BEFORE the app
        // died — i.e. not the wedge case.
        pullChangesMock.mockResolvedValue({
            ...EMPTY_PULL,
            attachments: [{
                id: ATTACHMENT_ID,
                farmId: 'farm-1',
                linkedEntityId: 'log-1',
                linkedEntityType: 'DailyLog',
                fileName: `${ATTACHMENT_ID}.jpg`,
                mimeType: 'image/jpeg',
                status: 'Finalized',
                sizeBytes: 2048,
                createdByUserId: 'user-1',
                createdAtUtc: '2026-08-13T18:00:00.000Z',
                modifiedAtUtc: '2026-08-14T06:00:00.000Z',
                uploadedAtUtc: '2026-08-13T18:00:05.000Z',
            }],
        });
        await backgroundSyncWorker.triggerNow();

        expect((await queueRow())?.status).toBe('completed');
    });

    it('THE WEDGE — the bytes never reached the server, so no pull can rescue it', async () => {
        await seedKilledMidUpload();

        // Server never got the file: it is absent from every pull, forever.
        pullChangesMock.mockResolvedValue(EMPTY_PULL);
        await backgroundSyncWorker.triggerNow();
        await backgroundSyncWorker.triggerNow();

        expect((await queueRow())?.status).toBe('uploading');
    });

    it('THE CLAIM — some path in the app can recover it', async () => {
        await seedKilledMidUpload();

        await resetFailedUploadsToPending();
        await backgroundSyncWorker.retryAllFailed();
        await attachmentUploadWorker.triggerNow();
        await backgroundSyncWorker.triggerNow();

        const row = await queueRow();
        expect(row?.status).not.toBe('uploading');
    });

    it("THE CLAIM (AI mirror) — a job left in 'processing' is picked up again", async () => {
        const db = getDatabase();
        const jobId = await db.pendingAiJobs.add({
            operationType: 'voice_parse',
            inputBlob: new Blob(['audio'], { type: 'audio/webm' }),
            inputMimeType: 'audio/webm',
            context: { farmId: 'farm-1', userId: 'user-1', operation: 'voice', idempotencyKey: 'clip-a43', parseContext: {} },
            status: 'processing',
            createdAt: '2026-08-13T18:00:00.000Z',
            updatedAt: '2026-08-13T18:00:00.000Z',
            retryCount: 0,
        });

        // SANITY: a sibling 'pending' job in the same table IS drained, so the
        // worker is genuinely running here.
        parseVoiceLogMock.mockResolvedValue({ parsedLog: {}, confidence: 1 });
        const healthyId = await db.pendingAiJobs.add({
            operationType: 'voice_parse',
            inputBlob: new Blob(['audio'], { type: 'audio/webm' }),
            inputMimeType: 'audio/webm',
            context: { farmId: 'farm-1', userId: 'user-1', operation: 'voice', idempotencyKey: 'clip-ok', parseContext: {} },
            status: 'pending',
            createdAt: '2026-08-13T18:00:00.000Z',
            updatedAt: '2026-08-13T18:00:00.000Z',
            retryCount: 0,
        });

        await AiJobWorker.run();
        await backgroundSyncWorker.triggerNow();

        expect((await db.pendingAiJobs.get(healthyId))?.status).toBe('completed');

        expect((await db.pendingAiJobs.get(jobId))?.status).not.toBe('processing');
    });
});
