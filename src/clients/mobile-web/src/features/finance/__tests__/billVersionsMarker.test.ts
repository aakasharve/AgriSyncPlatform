/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 fix round 1 (review M4). A phone that pulled its bills
 * before BILL-1 holds them with no version, so "मंजूर करा" could never be offered on them and a bill set aside before BILL-1
 * never reached तपासायचे. Once — and only against a server that says it sends every bill with its version — the phone asks
 * for one full re-pull (the established F1 path), so every bill comes back with its version. Never against an older server,
 * never twice, and never a guessed version.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, type AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { LOGS_REBUILD_MARKER_KEY } from '../../sync/pull/logsRebuildMarker';
import { BILL_VERSIONS_MARKER_KEY, settleBillVersions } from '../billVersionsMarker';

const FARM = '11111111-1111-4111-8111-111111111111';
const AT = '2026-11-07T05:00:00.000Z';

let db: AgriLogDatabase;

const bill = (id: string, over: Record<string, unknown> = {}) => db.costEntries.put({
    id, farmId: FARM, updatedAt: AT,
    payload: { id, farmId: FARM, amount: 31234.56, isCorrected: false, ...over },
} as never);

const f1Done = () => db.appMeta.put({ key: LOGS_REBUILD_MARKER_KEY, value: { rebuiltAtUtc: AT }, updatedAt: AT });

beforeEach(async () => {
    db = getDatabase();
    await db.open();
    await Promise.all(db.tables.map(t => t.clear()));
});

describe('bills pulled before BILL-1 get their version from the server, once', () => {
    it('a BILL-1 server and a bill held with no version: one full re-pull is asked for (the F1 marker is cleared)', async () => {
        await f1Done();
        await bill('old-1');
        await bill('new-1', { billVersion: 1 });

        expect(await settleBillVersions(db, { billVersions: true }, false)).toBe('requested');
        expect(await db.appMeta.get(LOGS_REBUILD_MARKER_KEY)).toBeUndefined();
        expect(await db.appMeta.get(BILL_VERSIONS_MARKER_KEY)).toBeUndefined();
    });

    it('the full pull that follows settles it for good: never asked again', async () => {
        await bill('old-1', { billVersion: 1 });
        expect(await settleBillVersions(db, { billVersions: true }, true)).toBe('done');
        expect(await db.appMeta.get(BILL_VERSIONS_MARKER_KEY)).toBeDefined();

        await f1Done();
        await bill('later-from-this-phone');
        expect(await settleBillVersions(db, { billVersions: true }, false)).toBe('done');
        expect(await db.appMeta.get(LOGS_REBUILD_MARKER_KEY)).toBeDefined();
    });

    it('every bill already carrying its version: nothing to ask, marked done', async () => {
        await f1Done();
        await bill('b-1', { billVersion: 2 });
        expect(await settleBillVersions(db, { billVersions: true }, false)).toBe('done');
        expect(await db.appMeta.get(LOGS_REBUILD_MARKER_KEY)).toBeDefined();
    });

    it('an older server (no billVersions) is never asked: no endless re-pulls, nothing marked', async () => {
        await f1Done();
        await bill('old-1');
        expect(await settleBillVersions(db, {}, false)).toBe('older-server');
        expect(await settleBillVersions(db, { billVersions: 'yes' }, true)).toBe('older-server');
        expect(await db.appMeta.get(LOGS_REBUILD_MARKER_KEY)).toBeDefined();
        expect(await db.appMeta.get(BILL_VERSIONS_MARKER_KEY)).toBeUndefined();
    });

    it('a version that is not a whole number counts as none (never a guessed version)', async () => {
        await f1Done();
        await bill('odd', { billVersion: 0 });
        expect(await settleBillVersions(db, { billVersions: true }, false)).toBe('requested');
    });
});
