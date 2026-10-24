// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.4 — Dexie → v24: strip the transcript out of correction rows that are
 * ALREADY on farmers' phones.
 *
 * THIS SHIPPED AS v23 AND WAS RENUMBERED. `feat/dfes-companion` also declares
 * 23, for a different schema, and it ships first. Dexie runs an upgrade only
 * for versions ABOVE the one on the device, so a handset that took DFES's v23
 * would have compared 23 to 23 and run nothing — the strip would never have
 * executed and the fix would have looked shipped while every existing
 * correction row kept the farmer's speech. The last describe block below is
 * the proof that the renumber actually closes that: a device sitting at 23 is
 * upgraded and stripped.
 *
 * spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.4
 *
 * Removing the fields from the TypeScript type stops new rows and does
 * nothing at all for the existing ones — that is a bleed-stop, not a fix.
 * These tests drive the real upgrade through fake-indexeddb and assert both
 * halves of the obligation:
 *
 *   1. the transcript is GONE from rows written at v22;
 *   2. the structured correction signal — field, AI value, farmer value,
 *      classification, bucket — is byte-identically INTACT. §P0.8 protects
 *      that signal from eviction; this removes only the transcript inside it.
 *
 * Plus the three properties that make a Dexie upgrade safe to ship:
 *   - it invents nothing;
 *   - it is idempotent per database (every farmer database on a shared
 *     handset runs it, so a three-farmer device runs it three times);
 *   - one malformed row cannot stop the database from opening.
 */

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { AgriLogDatabase, DATABASE_VERSION } from '../../DexieDatabase';
import { containsTranscriptText } from '../../../../domain/ai/contracts/transcriptRedaction';
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
import { applyV24 } from '../versions/v24';

/** The words a farmer said. Two worker names are inside them. */
const SPOKEN = 'आज रामू आणि सीता यांनी चार तास काम केले';
const CHUNK = 'रामू आणि सीता';

function applyThrough22(db: Dexie): void {
    applyV1(db); applyV2(db); applyV3(db); applyV4(db); applyV5(db);
    applyV6(db); applyV7(db); applyV8(db); applyV9(db); applyV10(db);
    applyV11(db); applyV12(db); applyV13(db); applyV14(db); applyV15(db);
    applyV16(db); applyV17(db); applyV18(db); applyV19(db); applyV20(db);
    applyV21(db); applyV22(db);
}

async function openV22(name: string): Promise<Dexie> {
    const db = new Dexie(name);
    applyThrough22(db);
    await db.open();
    return db;
}

async function openV24(name: string): Promise<Dexie> {
    const db = new Dexie(name);
    applyThrough22(db);
    applyV24(db);
    await db.open();
    return db;
}

/** A correction row in the v22 shape — `rawTranscript` was REQUIRED then. */
function legacyRow(id: string): Record<string, unknown> {
    return {
        id,
        extractionId: 'gemini:gemini-2.5-flash:2026-08-10T00:00:00.000Z',
        timestamp: '2026-08-10T00:00:00.000Z',
        fieldPath: 'labour',
        aiValue: [{ maleCount: 2, femaleCount: 0, hoursWorked: 4, sourceText: CHUNK }],
        userValue: [{ maleCount: 1, femaleCount: 1, hoursWorked: 4 }],
        rawTranscript: SPOKEN,
        sourceText: CHUNK,
        promptVersion: 'v42',
        correctionType: 'wrong_value',
        bucketId: 'labour',
    };
}

const DB_NAME = 'AgriLogDB_v24_upgrade_test';

describe('§P0.4 — Dexie v24: version constant', () => {
    it('DATABASE_VERSION is 25', () => {
        // Exact, not `>= 24`. 23 belongs to `feat/dfes-companion`; a silent
        // regression to it is the whole defect this renumber exists to remove.
        // 24 → 25 on Labour V2 R1 Task 3.5c: v25 adds the `attendanceMarks`
        // store (the attendance pull carriage). The v24 strip below is
        // unchanged and still asserted on the way THROUGH to 25.
        expect(DATABASE_VERSION).toBe(25);
    });
});

describe('§P0.4 — Dexie v24: store-completeness guard', () => {
    it('v24_re_lists_every_store_v22_had', async () => {
        const nameA = 'AgriLogDB_v24_storecount_v22';
        const dbA = new Dexie(nameA);
        applyThrough22(dbA);
        await dbA.open();
        const v22Stores = dbA.tables.map(t => t.name).sort();
        dbA.close();
        await Dexie.delete(nameA);

        const nameB = 'AgriLogDB_v24_storecount_v24';
        const dbB = new Dexie(nameB);
        applyThrough22(dbB);
        applyV24(dbB);
        await dbB.open();
        const v24Stores = dbB.tables.map(t => t.name).sort();
        dbB.close();
        await Dexie.delete(nameB);

        // A partial store list on a new version silently drops stores on
        // devices that have never seen the omitted ones.
        expect(v24Stores).toEqual(v22Stores);
    });
});

describe('§P0.4 — Dexie v22 → v24 upgrade', () => {
    beforeEach(async () => { await Dexie.delete(DB_NAME); });
    afterEach(async () => { await Dexie.delete(DB_NAME); });

    it('stored_correction_row_loses_its_raw_transcript_on_upgrade', async () => {
        const db22 = await openV22(DB_NAME);
        await db22.table('aiCorrectionEvents').put(legacyRow('corr-1'));
        // Sanity: the leak is real at v22, so the assertion below means something.
        const before = await db22.table('aiCorrectionEvents').get('corr-1');
        expect(JSON.stringify(before)).toContain(SPOKEN);
        db22.close();

        const db24 = await openV24(DB_NAME);
        const after = await db24.table('aiCorrectionEvents').get('corr-1') as Record<string, unknown>;
        db24.close();

        expect(after).toBeDefined();
        expect(after.rawTranscript).toBeUndefined();
        expect(after.sourceText).toBeUndefined();
        expect(JSON.stringify(after)).not.toContain(SPOKEN);
    });

    it('nested_source_text_is_stripped_from_ai_and_user_values', async () => {
        const db22 = await openV22(DB_NAME);
        await db22.table('aiCorrectionEvents').put(legacyRow('corr-2'));
        db22.close();

        const db24 = await openV24(DB_NAME);
        const after = await db24.table('aiCorrectionEvents').get('corr-2') as Record<string, unknown>;
        db24.close();

        // The worker names hid in the per-item `sourceText`, not only at the
        // top level. Deleting the two top-level keys alone would leave them.
        expect(JSON.stringify(after)).not.toContain(CHUNK);
        expect(JSON.stringify(after)).not.toContain('रामू');
        expect(containsTranscriptText(after)).toBe(false);
    });

    it('structured_correction_signal_survives_the_upgrade', async () => {
        const db22 = await openV22(DB_NAME);
        await db22.table('aiCorrectionEvents').put(legacyRow('corr-3'));
        db22.close();

        const db24 = await openV24(DB_NAME);
        const after = await db24.table('aiCorrectionEvents').get('corr-3') as Record<string, unknown>;
        db24.close();

        // This is the half that must NOT be lost. It is the AI learning
        // loop's input and it has no other home.
        expect(after.id).toBe('corr-3');
        expect(after.fieldPath).toBe('labour');
        expect(after.correctionType).toBe('wrong_value');
        expect(after.bucketId).toBe('labour');
        expect(after.promptVersion).toBe('v42');
        expect(after.extractionId).toBe('gemini:gemini-2.5-flash:2026-08-10T00:00:00.000Z');
        expect(after.timestamp).toBe('2026-08-10T00:00:00.000Z');
        expect(after.aiValue).toEqual([{ maleCount: 2, femaleCount: 0, hoursWorked: 4 }]);
        expect(after.userValue).toEqual([{ maleCount: 1, femaleCount: 1, hoursWorked: 4 }]);
    });

    it('the_upgrade_invents_nothing', async () => {
        const db22 = await openV22(DB_NAME);
        await db22.table('aiCorrectionEvents').put(legacyRow('corr-4'));
        db22.close();

        const db24 = await openV24(DB_NAME);
        const after = await db24.table('aiCorrectionEvents').get('corr-4') as Record<string, unknown>;
        db24.close();

        const legacyKeys = new Set(Object.keys(legacyRow('corr-4')));
        // Every surviving key existed before. No placeholder, no default,
        // no "[redacted]" filler standing in for the removed speech.
        expect(Object.keys(after).every(k => legacyKeys.has(k))).toBe(true);
        expect(JSON.stringify(after).toLowerCase()).not.toContain('redacted');
    });

    it('other_stores_are_untouched_by_the_upgrade', async () => {
        const db22 = await openV22(DB_NAME);
        // A farmer's own log legitimately holds their own words. §P0.4 is
        // scoped to correction events; deleting the farmer's copy of their
        // own day is a founder decision, not this migration's business.
        await db22.table('logs').put({
            id: 'log-1', date: '2026-08-10', verificationStatus: 'CONFIRMED', isDeleted: 0,
            log: { id: 'log-1', fullTranscript: SPOKEN, cropActivities: [] },
        });
        db22.close();

        const db24 = await openV24(DB_NAME);
        const log = await db24.table('logs').get('log-1') as { log: { fullTranscript: string } };
        db24.close();

        expect(log.log.fullTranscript).toBe(SPOKEN);
    });

    it('the_upgrade_is_idempotent_per_database', async () => {
        // A shared handset holds one database per farmer, and this upgrade
        // runs once for each. Re-running it must be the identity.
        const db22 = await openV22(DB_NAME);
        await db22.table('aiCorrectionEvents').put(legacyRow('corr-5'));
        db22.close();

        const first = await openV24(DB_NAME);
        const afterFirst = await first.table('aiCorrectionEvents').get('corr-5');
        first.close();

        const second = await openV24(DB_NAME);
        const afterSecond = await second.table('aiCorrectionEvents').get('corr-5');
        second.close();

        expect(afterSecond).toEqual(afterFirst);
        expect(containsTranscriptText(afterSecond)).toBe(false);
    });

    it('a_row_already_free_of_transcript_passes_through_unchanged', async () => {
        const clean = {
            id: 'corr-6',
            extractionId: 'e',
            timestamp: '2026-08-10T00:00:00.000Z',
            fieldPath: 'irrigation',
            aiValue: [{ durationHours: 3 }],
            userValue: [{ durationHours: 2 }],
            promptVersion: 'v42',
            correctionType: 'wrong_value',
            bucketId: 'irrigation',
        };
        const db22 = await openV22(DB_NAME);
        await db22.table('aiCorrectionEvents').put(clean);
        db22.close();

        const db24 = await openV24(DB_NAME);
        const after = await db24.table('aiCorrectionEvents').get('corr-6');
        db24.close();

        expect(after).toEqual(clean);
    });

    it('a_malformed_row_does_not_block_the_database_from_opening', async () => {
        // One bad row aborting the upgrade transaction leaves the farmer
        // with an app that cannot open its database at all — strictly worse
        // than the leak being closed. Every row is guarded independently.
        const db22 = await openV22(DB_NAME);
        await db22.table('aiCorrectionEvents').bulkPut([
            { id: 'bad-1' },                                     // nothing but a key
            { id: 'bad-2', aiValue: 'not-an-array', rawTranscript: SPOKEN },
            legacyRow('good-1'),
        ]);
        db22.close();

        const db24 = await openV24(DB_NAME);
        const good = await db24.table('aiCorrectionEvents').get('good-1') as Record<string, unknown>;
        const count = await db24.table('aiCorrectionEvents').count();
        db24.close();

        // The database opened, every row is still there, and the good row
        // was still cleaned despite its neighbours.
        expect(count).toBe(3);
        expect(good.rawTranscript).toBeUndefined();
        expect(JSON.stringify(good)).not.toContain(SPOKEN);
    });
});

// ---------------------------------------------------------------------------
// THE RENUMBER ITSELF. This is the block that justifies 23 → 24.
// ---------------------------------------------------------------------------

/**
 * A handset that took `feat/dfes-companion` FIRST.
 *
 * The DFES build is modelled as base + DFES's own v23, which is the state that
 * leaves "23" recorded in IndexedDB with `pendingInterpretations` in it.
 *
 * REVIEW C1 — WHAT THIS USED TO GET WRONG, because the correction is the whole
 * lesson. The "this branch arrives" side used to be
 * `applyThrough22 + applyDfesV23 + applyV24`, assembled locally. That chain does
 * not exist in any build: `DexieDatabase.ts` wires `applyV1..applyV24`. So the
 * test SUPPLIED the v23 declaration whose ABSENCE was the danger, and then
 * concluded the declaration was unnecessary. It passed, and it was proving a
 * property of the fixture.
 *
 * Measured against the repo's own dexie 4.3.0, seeded identically:
 *   synthetic chain (base + dfesV23 + v24) -> verno 24, store present, rows 1
 *   real chain      (new AgriLogDatabase)  -> verno 24, InvalidTableError, gone
 *
 * Dexie's schema is the UNION of the versions the running build DECLARES, and a
 * store survives only while some version STILL IN THAT CHAIN declares it. The
 * fix is in production, not here: `DexieDatabase.ts` now declares v23.
 *
 * So every "this branch arrives" case below opens the REAL `AgriLogDatabase`.
 * A test that assembles its own chain cannot answer this question.
 */
function applyDfesV23(db: Dexie): void {
    db.version(23).stores({
        pendingInterpretations: 'captureId, farmId, status, createdAtUtc, [status+createdAtUtc]',
    });
}

async function openDfesV23(name: string): Promise<Dexie> {
    const db = new Dexie(name);
    applyThrough22(db);
    applyDfesV23(db);
    await db.open();
    return db;
}

/**
 * This branch arriving on that handset — THE REAL PRODUCTION CLASS, no locally
 * assembled chain. If `DexieDatabase.ts` ever drops a version declaration, these
 * tests are what notices.
 */
async function openRealAppDatabase(name: string): Promise<Dexie> {
    const db = new AgriLogDatabase(name);
    await db.open();
    return db as unknown as Dexie;
}

describe('§P0.4 — the renumber: a device already at 23 still gets stripped', () => {
    const DFES_DB = 'AgriLogDB_dfes_v23_then_v24';

    beforeEach(async () => { await Dexie.delete(DFES_DB); });
    afterEach(async () => { await Dexie.delete(DFES_DB); });

    it('a_handset_that_took_DFES_v23_first_runs_the_transcript_strip_on_the_way_to_24', async () => {
        // The farmer's phone is at 23 because DFES shipped first, and it holds a
        // correction row written before any of this — with their speech in it.
        const dfes = await openDfesV23(DFES_DB);
        await dfes.table('aiCorrectionEvents').put(legacyRow('corr-dfes'));
        expect(dfes.verno).toBe(23);
        const before = await dfes.table('aiCorrectionEvents').get('corr-dfes');
        expect(JSON.stringify(before)).toContain(SPOKEN);
        dfes.close();

        // This branch arrives.
        const upgraded = await openRealAppDatabase(DFES_DB);
        const after = await upgraded.table('aiCorrectionEvents').get('corr-dfes') as Record<string, unknown>;
        const verno = upgraded.verno;
        upgraded.close();

        // 25 since Labour V2 R1 Task 3.5c — the real chain now ends at v25
        // (attendanceMarks store); everything else this test proves is unchanged.
        expect(verno).toBe(25);
        // THE POINT OF THE RENUMBER. Had this branch also declared 23, Dexie
        // would have compared 23 to 23, run nothing, and left every one of these
        // rows carrying the farmer's raw speech and worker names for ever.
        expect(after.rawTranscript).toBeUndefined();
        expect(after.sourceText).toBeUndefined();
        expect(JSON.stringify(after)).not.toContain(SPOKEN);
        expect(containsTranscriptText(after)).toBe(false);
    });

    it('C1_DFES_own_store_and_its_rows_survive_the_REAL_app_database_arriving_after_it', async () => {
        // THE ONE THAT WAS WRONG. It used to open a locally assembled chain that
        // included DFES's v23, so it proved nothing about the build we ship.
        // Against the real `AgriLogDatabase` before the fix this failed with
        // `InvalidTableError` and 32 tables — the store and every row deleted,
        // silently, with the upgrade reporting success.
        const dfes = await openDfesV23(DFES_DB);
        await dfes.table('pendingInterpretations').bulkPut([
            { captureId: 'cap-1', farmId: 'f1', status: 'pending', createdAtUtc: 1 },
            { captureId: 'cap-2', farmId: 'f1', status: 'failed', createdAtUtc: 2 },
        ]);
        expect(dfes.verno).toBe(23);
        dfes.close();

        const upgraded = await openRealAppDatabase(DFES_DB);
        const names = upgraded.tables.map(t => t.name);
        const surviving = await upgraded.table('pendingInterpretations').toArray();
        const verno = upgraded.verno;
        upgraded.close();

        // 25 since Labour V2 R1 Task 3.5c — the real chain now ends at v25
        // (attendanceMarks store); everything else this test proves is unchanged.
        expect(verno).toBe(25);
        expect(names).toContain('pendingInterpretations');
        // The ROWS, not just the store. A recreated-but-empty store would satisfy
        // a names-only assertion and would still have lost the farmer's captures.
        expect(surviving.map(r => (r as { captureId: string }).captureId).sort())
            .toEqual(['cap-1', 'cap-2']);
    });

    it('C1_a_device_that_never_saw_DFES_still_reaches_24_and_gets_the_store_empty', async () => {
        // The cost of carrying another branch's declaration: one empty store this
        // branch never touches. Asserted so the cost is a fact rather than a
        // claim, and so an accidental `.upgrade()` on v23 would show up here.
        const db22 = await openV22(DFES_DB);
        await db22.table('aiCorrectionEvents').put(legacyRow('corr-fresh'));
        db22.close();

        const upgraded = await openRealAppDatabase(DFES_DB);
        const verno = upgraded.verno;
        const rows = await upgraded.table('pendingInterpretations').count();
        const after = await upgraded.table('aiCorrectionEvents').get('corr-fresh') as Record<string, unknown>;
        upgraded.close();

        // 25 since Labour V2 R1 Task 3.5c — the real chain now ends at v25
        // (attendanceMarks store); everything else this test proves is unchanged.
        expect(verno).toBe(25);
        expect(rows).toBe(0);
        // And the strip still ran on the way through.
        expect(containsTranscriptText(after)).toBe(false);
    });

    it('the_ordinary_path_is_unaffected_a_device_at_22_goes_straight_to_24', async () => {
        // Most handsets have never seen 23 at all. Dexie skips the gap.
        const db22 = await openV22(DB_NAME);
        await db22.table('aiCorrectionEvents').put(legacyRow('corr-22'));
        expect(db22.verno).toBe(22);
        db22.close();

        const db24 = await openV24(DB_NAME);
        const after = await db24.table('aiCorrectionEvents').get('corr-22') as Record<string, unknown>;
        const verno = db24.verno;
        db24.close();
        await Dexie.delete(DB_NAME);

        expect(verno).toBe(24);
        expect(after.rawTranscript).toBeUndefined();
        expect(containsTranscriptText(after)).toBe(false);
    });
});
