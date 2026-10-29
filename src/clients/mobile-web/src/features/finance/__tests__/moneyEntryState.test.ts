/**
 * spec: pre-launch-repair L2a (D-19 "honest upload states") — a money entry is "on the server" only on the
 * server's own word (an APPLIED queue row, or the server's copy back from a pull); anything else is on this
 * phone, and a rejected or given-up entry needs the farmer. Same rule as the header chip.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { billClaim, entryClaim, readMoneyEvidence, type MoneyEvidence } from '../moneyEntryState';

const evidence = (over: Partial<MoneyEvidence>): MoneyEvidence => ({ rows: [], server: [], photos: new Map(), ...over });

describe('entryClaim (वही)', () => {
    it('queued, not yet acknowledged → on this phone', () => {
        expect(entryClaim(evidence({ rows: [{ id: 'e1', status: 'PENDING', retryCount: 0 }] }), 'e1')).toBe('ON_PHONE');
        expect(entryClaim(evidence({ rows: [{ id: 'e1', status: 'FAILED', retryCount: 1 }] }), 'e1')).toBe('ON_PHONE');
    });

    it('reached no queue at all (e.g. no farm known) → on this phone, never on the server', () => {
        expect(entryClaim(evidence({ rows: [{ id: 'other', status: 'APPLIED', retryCount: 0 }] }), 'e1')).toBe('ON_PHONE');
    });

    it('acknowledged by the server (APPLIED) or its copy came back → on the server', () => {
        expect(entryClaim(evidence({ rows: [{ id: 'e1', status: 'APPLIED', retryCount: 0 }] }), 'e1')).toBe('ON_SERVER');
        expect(entryClaim(evidence({ server: [{ id: 'e1' }] }), 'e1')).toBe('ON_SERVER');
    });

    it('rejected, or given up after the retry cap → needs the farmer', () => {
        expect(entryClaim(evidence({ rows: [{ id: 'e1', status: 'REJECTED_USER_REVIEW', retryCount: 0 }] }), 'e1')).toBe('NEEDS_FIX');
        expect(entryClaim(evidence({ rows: [{ id: 'e1', status: 'FAILED', retryCount: 99 }] }), 'e1')).toBe('NEEDS_FIX');
    });
});

describe('billClaim (खरेदी) — by the bill lines\' own keys; the weakest line wins', () => {
    it('one line on the server and one still queued → on this phone', () => {
        const e = evidence({ rows: [{ description: 'b1:l2', status: 'PENDING', retryCount: 0 }], server: [{ description: 'b1:l1' }] });
        expect(billClaim(e, ['b1:l1', 'b1:l2'])).toBe('ON_PHONE');
    });

    it('every line acknowledged → on the server; a line with no evidence at all forbids "on the server"', () => {
        const e = evidence({ server: [{ description: 'b1:l1' }, { description: 'b1:l2' }] });
        expect(billClaim(e, ['b1:l1', 'b1:l2'])).toBe('ON_SERVER');
        expect(billClaim(e, ['b1:l1', 'b1:l2', 'b1:l3'])).toBeNull();
    });

    // L2a review m6 — a legacy bill whose lines were all ₹0 but whose total > 0 now computes `<bill>:total`,
    // a key that was never queued: no "पाठवणे बाकी" for money that will never be sent.
    it('a key that was never queued and is not on the server makes no claim (legacy `:total`)', () => {
        const legacy = evidence({ rows: [{ description: 'b2:l1', status: 'APPLIED', retryCount: 0 }] });
        expect(billClaim(legacy, ['b2:total'])).toBeNull();
        expect(billClaim(evidence({}), ['b2:total'])).toBeNull();
    });

    it('…unless the queue itself says the bill money is on the phone (or needs the farmer)', () => {
        expect(billClaim(evidence({ rows: [{ description: 'b3:l1', status: 'PENDING', retryCount: 0 }] }), ['b3:l1', 'b3:l2'])).toBe('ON_PHONE');
        expect(billClaim(evidence({ rows: [{ description: 'b3:l1', status: 'REJECTED_USER_REVIEW', retryCount: 0 }] }), ['b3:l1', 'b3:l2'])).toBe('NEEDS_FIX');
    });

    it('a bill with no money lines makes no claim', () => {
        expect(billClaim(evidence({}), [])).toBeNull();
    });
});

describe('readMoneyEvidence — reads the queue, the server copies and the photo states the app already keeps', () => {
    it('maps add_cost_entry rows, pulled cost entries and attachment states', async () => {
        const db = getDatabase();
        const now = '2026-10-29T00:00:00.000Z';
        await db.mutationQueue.add({
            deviceId: 'd', clientRequestId: 'r1', clientCommandId: 'c1', mutationType: SyncMutationName.AddCostEntry,
            payload: { costEntryId: 'e1', description: 'b1:l1' }, status: 'PENDING', createdAt: now, updatedAt: now, retryCount: 0,
        });
        await db.costEntries.put({ id: 'e2', farmId: 'f', payload: { id: 'e2', description: 'b1:l2' }, updatedAt: now } as never);
        await db.attachments.put({
            id: 'att-1', farmId: 'f', linkedEntityId: 'f', linkedEntityType: 'Farm', originalFileName: 'bill.png',
            mimeType: 'image/png', sizeBytes: 1, status: 'uploaded', createdAt: now, updatedAt: now, retryCount: 0,
        } as never);

        const read = await readMoneyEvidence();
        expect(read.rows).toEqual([{ id: 'e1', description: 'b1:l1', status: 'PENDING', retryCount: 0 }]);
        expect(read.server).toEqual([{ id: 'e2', description: 'b1:l2' }]);
        expect(read.photos.get('att-1')).toBe('uploaded');
        expect(billClaim(read, ['b1:l1', 'b1:l2'])).toBe('ON_PHONE');
        expect(entryClaim(read, 'e2')).toBe('ON_SERVER');
    });
});
