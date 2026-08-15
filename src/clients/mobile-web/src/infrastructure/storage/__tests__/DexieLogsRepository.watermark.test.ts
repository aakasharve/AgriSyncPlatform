// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.7 review B003 — `serverModifiedAtUtc` SURVIVES EVERY LOCAL WRITE.
 *
 * The watermark has exactly one writer, `reconcileLogs`, and two readers that
 * both matter:
 *
 *   1. the pull's freshness guard, which uses it to refuse a STALE server row
 *      over a fresher local one; and
 *   2. since §P0.7 box 2e, `strandedLogReconciler`, which treats its ABSENCE as
 *      "this device authored the log and the server has never seen it".
 *
 * So a local write that erases it does two things: it disarms the guard, and it
 * makes an already-synced log look locally-authored — at which point the
 * reconciler re-enqueues a record the server already has as a fresh create.
 *
 * `toRecordPreservingWatermark` was extracted to make that impossible, and three
 * of the four writers were converted. `updateVerification` was missed. It has no
 * production caller today, so nothing was broken — but "safe as long as nobody
 * calls that method" is not an invariant, and box 2e's safety now leans on it.
 *
 * This file is the invariant, held over ALL FOUR writers rather than the one
 * that was wrong, so the next writer added to this repository has an assertion
 * waiting for it instead of a convention to notice.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { resetDatabase, getDatabase } from '../DexieDatabase';
import { DexieLogsRepository } from '../DexieLogsRepository';
import type { DailyLog } from '../../../types';

const LOG_ID = 'a1111111-1111-4111-8111-111111111111';
const WATERMARK = '2026-08-14T05:00:00.000Z';

function log(overrides: Partial<DailyLog> = {}): DailyLog {
    return {
        id: LOG_ID,
        date: '2026-08-14',
        context: { selection: [] },
        dayOutcome: {},
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        financialSummary: {
            totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0,
        },
        ...overrides,
    } as unknown as DailyLog;
}

async function seedPulledLog() {
    // Exactly the shape `reconcileLogs` writes: a log that came DOWN from the
    // server, carrying its watermark.
    await getDatabase().logs.put({
        id: LOG_ID,
        schemaVersion: 2,
        log: log(),
        date: '2026-08-14',
        isDeleted: 0,
        serverModifiedAtUtc: WATERMARK,
    });
}

async function watermark(): Promise<string | undefined> {
    return (await getDatabase().logs.get(LOG_ID))?.serverModifiedAtUtc;
}

describe('DexieLogsRepository — the sync watermark survives every local write', () => {
    beforeEach(async () => {
        const db = getDatabase();
        try {
            await db.delete();
        } catch {
            // ignore
        }
        await resetDatabase();
        await seedPulledLog();
    });

    it('save preserves it', async () => {
        await DexieLogsRepository.getInstance().save(log({ date: '2026-08-15' } as Partial<DailyLog>));

        expect(await watermark()).toBe(WATERMARK);
    });

    it('batchSave preserves it', async () => {
        await DexieLogsRepository.getInstance().batchSave([log({ date: '2026-08-15' } as Partial<DailyLog>)]);

        expect(await watermark()).toBe(WATERMARK);
    });

    it('delete preserves it', async () => {
        await DexieLogsRepository.getInstance().delete(LOG_ID, 'owner', 'wrong day');

        expect(await watermark()).toBe(WATERMARK);
    });

    it('B003_updateVerification_preserves_it_too_the_one_writer_that_did_not', async () => {
        // The bug: a bare `toRecord(updatedLog)` here erased the watermark, so
        // this log would afterwards look locally-authored to the box 2e
        // reconciler and be re-enqueued as a create the server already has.
        await DexieLogsRepository.getInstance().updateVerification(LOG_ID, 'CONFIRMED' as never, 'owner');

        expect(await watermark()).toBe(WATERMARK);
    });

    it('a log this device never pulled still gets NO watermark — none of this invents one', async () => {
        await getDatabase().logs.clear();

        await DexieLogsRepository.getInstance().save(log());

        expect(await watermark()).toBeUndefined();
    });
});
