// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfes-companion Phase 4 (Slice 2) — Dexie v22 → v23 upgrade tests.
 *
 * spec: dfes-companion-2026-07-11
 *
 * v23 is a PURELY ADDITIVE schema bump: it introduces the
 * `pendingInterpretations` store (voice-continuity captures that could not be
 * structured at record time) and re-lists every v22 store verbatim. There is
 * NO `.upgrade()` callback and NO row migration.
 *
 * This file proves the two things the DATABASE_VERSION constant assertion
 * cannot: that a farmer's real OFFLINE data SURVIVES the upgrade, and that the
 * v23 addition is actually there and usable. A bad additive bump (a dropped
 * store, a fat-fingered store list) silently deletes local logs on real
 * devices — this test is the guard.
 *
 * It locks:
 *   1. Data survival — a `logs` row, a queued `mutationQueue` row, and a
 *      `voiceClips` row seeded at v22 are all still present + field-intact
 *      after the DB is re-opened at v23 (the upgrade runs on re-open).
 *   2. The v23 addition exists — `pendingInterpretations` does NOT exist at v22
 *      (proving the store is genuinely new), and IS usable at v23: a row can be
 *      written and read back BOTH by primary key AND via the new
 *      `[status+createdAtUtc]` compound index.
 *
 * Uses fake-indexeddb (as the v16 / v17 / v22 upgrade tests do) driving the
 * full v1→v23 version chain, so the real Dexie upgrade machinery executes.
 */

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DATABASE_VERSION } from '../../DexieDatabase';
import { applyV1 } from '../versions/v1';
import { applyV2 } from '../versions/v2';
import { applyV3 } from '../versions/v3';
import { applyV4 } from '../versions/v4';
import { applyV5 } from '../versions/v5';
import { applyV6 } from '../versions/v6';
import { applyV7 } from '../versions/v7';
import { applyV8 } from '../versions/v8';
import { applyV9 } from '../versions/v9';
import { applyV10 } from '../versions/v10';
import { applyV11 } from '../versions/v11';
import { applyV12 } from '../versions/v12';
import { applyV13 } from '../versions/v13';
import { applyV14 } from '../versions/v14';
import { applyV15 } from '../versions/v15';
import { applyV16 } from '../versions/v16';
import { applyV17 } from '../versions/v17';
import { applyV18 } from '../versions/v18';
import { applyV19 } from '../versions/v19';
import { applyV20 } from '../versions/v20';
import { applyV21 } from '../versions/v21';
import { applyV22 } from '../versions/v22';
import { applyV23 } from '../versions/v23';

const DB_NAME = 'AgriLogDB_v23_upgrade_test';

/** Minimal `logs` row shape (mirrors the offline diary blob). */
interface MinimalLogRow {
    id: string;
    date: string;
    verificationStatus: string;
    createdByOperatorId?: string;
    isDeleted: 0 | 1;
    log: {
        id: string;
        cropActivities: Array<{ id: string; title: string; provenance?: string }>;
        [key: string]: unknown;
    };
}

/** Minimal `mutationQueue` row (an unsynced offline write). */
interface MinimalMutationRow {
    id?: number;
    deviceId: string;
    clientRequestId: string;
    status: string;
    mutationType: string;
    createdAt: number;
    payloadJson: string;
}

/** Minimal `voiceClips` row (a durable offline capture). */
interface MinimalVoiceClipRow {
    id: string;
    farmId: string;
    recordedAtUtc: string;
    status: string;
    retentionPolicy: string;
    localBlobRef: string;
}

/** Minimal `pendingInterpretations` row — the NEW v23 store. */
interface MinimalPendingInterpretationRow {
    captureId: string;
    farmId: string;
    status: string;
    createdAtUtc: number;
    transcript: string | null;
}

/** Apply the full version chain up to (and including) v22. */
function applyChainToV22(db: Dexie): void {
    applyV1(db);
    applyV2(db);
    applyV3(db);
    applyV4(db);
    applyV5(db);
    applyV6(db);
    applyV7(db);
    applyV8(db);
    applyV9(db);
    applyV10(db);
    applyV11(db);
    applyV12(db);
    applyV13(db);
    applyV14(db);
    applyV15(db);
    applyV16(db);
    applyV17(db);
    applyV18(db);
    applyV19(db);
    applyV20(db);
    applyV21(db);
    applyV22(db);
}

async function openV22(): Promise<Dexie> {
    const db = new Dexie(DB_NAME);
    applyChainToV22(db);
    await db.open();
    return db;
}

async function openV23(): Promise<Dexie> {
    const db = new Dexie(DB_NAME);
    applyChainToV22(db);
    applyV23(db);
    await db.open();
    return db;
}

async function deleteDb(): Promise<void> {
    await Dexie.delete(DB_NAME);
}

// ============================================================================
// Constant guard
// ============================================================================

describe('dfes v23 — DATABASE_VERSION constant', () => {
    it('DATABASE_VERSION is 23', () => {
        expect(DATABASE_VERSION).toBe(23);
    });
});

// ============================================================================
// v22 → v23 data survival + additive-store round-trip
// ============================================================================

describe('dfes v22 → v23 upgrade: offline data survives + new store is usable', () => {
    beforeEach(async () => {
        await deleteDb();
    });

    afterEach(async () => {
        await deleteDb();
    });

    it('the new pendingInterpretations store does NOT exist at v22 (it is genuinely new)', async () => {
        const db22 = await openV22();
        // Accessing an undeclared store throws in Dexie — this is what proves
        // the store is NEW at v23, so the "usable at v23" assertion below is
        // meaningful and not a tautology.
        expect(() => db22.table('pendingInterpretations')).toThrow();
        db22.close();
    });

    it('a logs row + a queued mutation + a voice clip seeded at v22 all survive the upgrade to v23 intact', async () => {
        // --- seed representative OFFLINE data at v22 ---
        const db22 = await openV22();

        const logRow: MinimalLogRow = {
            id: 'log-survive-1',
            date: '2026-07-12',
            verificationStatus: 'DRAFT',
            isDeleted: 0,
            log: {
                id: 'log-survive-1',
                cropActivities: [
                    { id: 'ca-1', title: 'द्राक्ष छाटणी', provenance: 'spoken' },
                ],
            },
        };
        const mutationRow: MinimalMutationRow = {
            deviceId: 'device-abc',
            clientRequestId: 'req-001',
            status: 'PENDING',
            mutationType: 'CREATE_LOG',
            createdAt: 1_752_300_000_000,
            payloadJson: '{"crop":"grapes"}',
        };
        const voiceClipRow: MinimalVoiceClipRow = {
            id: 'clip-survive-1',
            farmId: 'farm-1',
            recordedAtUtc: '2026-07-12T05:30:00.000Z',
            status: 'STORED',
            retentionPolicy: 'DURABLE',
            localBlobRef: 'blob://clip-survive-1',
        };

        await db22.table('logs').add(logRow);
        await db22.table('mutationQueue').add(mutationRow);
        await db22.table('voiceClips').add(voiceClipRow);
        // Capture the auto-assigned mutationQueue id so we can prove the SAME
        // row (not just a count) comes back after the upgrade.
        const seededMutation = await db22
            .table('mutationQueue')
            .where('[deviceId+clientRequestId]')
            .equals(['device-abc', 'req-001'])
            .first() as MinimalMutationRow | undefined;
        expect(seededMutation).toBeDefined();
        db22.close();

        // --- upgrade to v23 (the upgrade runs on re-open) ---
        const db23 = await openV23();

        const recoveredLog = await db23.table('logs').get('log-survive-1') as MinimalLogRow | undefined;
        const recoveredClip = await db23.table('voiceClips').get('clip-survive-1') as MinimalVoiceClipRow | undefined;
        const recoveredMutation = await db23
            .table('mutationQueue')
            .where('[deviceId+clientRequestId]')
            .equals(['device-abc', 'req-001'])
            .first() as MinimalMutationRow | undefined;

        // (a) logs row — present + fields intact (incl. nested activity + provenance)
        expect(recoveredLog).toBeDefined();
        expect(recoveredLog?.date).toBe('2026-07-12');
        expect(recoveredLog?.verificationStatus).toBe('DRAFT');
        expect(recoveredLog?.log.cropActivities[0]?.title).toBe('द्राक्ष छाटणी');
        expect(recoveredLog?.log.cropActivities[0]?.provenance).toBe('spoken');

        // (b) queued mutation — same row, fields intact
        expect(recoveredMutation).toBeDefined();
        expect(recoveredMutation?.id).toBe(seededMutation?.id);
        expect(recoveredMutation?.status).toBe('PENDING');
        expect(recoveredMutation?.mutationType).toBe('CREATE_LOG');
        expect(recoveredMutation?.payloadJson).toBe('{"crop":"grapes"}');

        // (c) voice clip — present + fields intact
        expect(recoveredClip).toBeDefined();
        expect(recoveredClip?.farmId).toBe('farm-1');
        expect(recoveredClip?.status).toBe('STORED');
        expect(recoveredClip?.retentionPolicy).toBe('DURABLE');
        expect(recoveredClip?.localBlobRef).toBe('blob://clip-survive-1');

        db23.close();
    });

    it('the v23 pendingInterpretations store is usable after upgrade — round-trips by primary key AND by the [status+createdAtUtc] index', async () => {
        // Establish a v22 DB (so v23 is a genuine upgrade, not a fresh create).
        const db22 = await openV22();
        db22.close();

        const db23 = await openV23();

        const capture: MinimalPendingInterpretationRow = {
            captureId: 'cap-1',
            farmId: 'farm-1',
            status: 'pending',
            createdAtUtc: 1_752_400_000_000,
            transcript: 'आज ठिबक चालू केलं',
        };
        await db23.table('pendingInterpretations').add(capture);

        // By primary key.
        const byPk = await db23
            .table('pendingInterpretations')
            .get('cap-1') as MinimalPendingInterpretationRow | undefined;
        expect(byPk).toBeDefined();
        expect(byPk?.farmId).toBe('farm-1');
        expect(byPk?.transcript).toBe('आज ठिबक चालू केलं');

        // Via the NEW compound index — proves the index (not just the store) exists.
        const byIndex = await db23
            .table('pendingInterpretations')
            .where('[status+createdAtUtc]')
            .equals(['pending', 1_752_400_000_000])
            .first() as MinimalPendingInterpretationRow | undefined;
        expect(byIndex).toBeDefined();
        expect(byIndex?.captureId).toBe('cap-1');

        db23.close();
    });
});
