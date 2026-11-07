/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who
 * and when"). The phone half of a bill's मंजूर, on a real Dexie (fake-indexeddb) at the shipped version — no bump:
 *   - who may approve (the server's rule, fail closed);
 *   - where a bill stands (approved / approved for an older version / not), read from the pull's new fields — and an
 *     older server's `isFlagged` still read exactly as before;
 *   - the queued approval passes the contract and names the version on screen;
 *   - what this phone still holds: waiting, refused because the bill changed (the L4b code), refused otherwise.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApproveCostEntryPayload } from '../../../../../../../sync-contract/schemas/payloads';
import { getDatabase, type AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { financeService } from '../financeService';
import {
    BILL_VERSION_CONFLICT_CODE,
    approvalIsDue,
    approveBill,
    billStamp,
    buildApprovePayload,
    mayApproveBills,
    readBillApprovalOutbox,
} from '../billApproval';

const FARM = '11111111-1111-4111-8111-111111111111';
const FARM_B = '33333333-3333-4333-8333-333333333333';
const BILL = 'b1110000-0000-4000-8000-000000000001';
const REVIEWER = '22222222-2222-4222-8222-222222222222';
const AT = '2026-11-07T05:00:00.000Z';

const pulled = (over: Record<string, unknown> = {}) => ({
    id: BILL, farmId: FARM, categoryId: 'fertilizer', description: 'खत', amount: 31234.56, currencyCode: 'INR',
    entryDate: '2026-11-06', createdByUserId: REVIEWER, createdAtUtc: AT, modifiedAtUtc: AT, isCorrected: false, ...over,
});

const stamp = (billVersion: number, over: Record<string, unknown> = {}) => ({
    id: 'a1110000-0000-4000-8000-000000000001', approvedByUserId: REVIEWER, approvedByName: 'मुकादम-गणेश',
    approvedAtUtc: AT, billVersion, ...over,
});

function read(entries: Record<string, unknown>[]) {
    window.dispatchEvent(new CustomEvent('agrisync:finance-sync-payload', {
        detail: { costEntries: entries, corrections: [], priceConfigs: [] },
    }));
    return financeService.peekMoneyEvents().find(e => e.id === BILL)!;
}

let db: AgriLogDatabase;

beforeEach(async () => {
    db = getDatabase();
    await db.open();
    await Promise.all(db.tables.map(t => t.clear()));
    await financeService.refreshFromPhone();
    await financeService.refreshFromPhone();
});

describe('who may approve a bill — the server\'s rule, fail closed', () => {
    it('the primary account holder, or a seat the server says holds review money', () => {
        expect(mayApproveBills({ role: 'PrimaryOwner', authorities: undefined } as never)).toBe(true);
        expect(mayApproveBills({ role: 'Mukadam', authorities: [{ name: 'SeeMoney' }, { name: 'ReviewMoney' }] } as never)).toBe(true);
    });

    it('nobody else: see money alone, a सहमालक label, no list, no farm', () => {
        expect(mayApproveBills({ role: 'Mukadam', authorities: [{ name: 'SeeMoney' }] } as never)).toBe(false);
        expect(mayApproveBills({ role: 'SecondaryOwner', authorities: undefined } as never)).toBe(false);
        expect(mayApproveBills({ role: 'Worker', authorities: [] } as never)).toBe(false);
        expect(mayApproveBills(null)).toBe(false);
    });
});

describe('where a bill stands, read from the pull', () => {
    it('a set-aside bill nobody approved is तपासायचे and due', () => {
        const bill = read([pulled({ billVersion: 1, needsReview: true, reviewReason: 'High amount: >= 25000 INR' })]);
        expect(bill.reviewStatus).toBe('NeedsReview');
        expect(bill.reviewReasons).toEqual(['High amount: >= 25000 INR']);
        expect(billStamp(bill)).toBe('none');
        expect(approvalIsDue(bill)).toBe(true);
        expect(bill.trustStatus).toBe('Unverified');
    });

    it('approved for the version it stands at: मंजूर, no longer तपासायचे, not due', () => {
        const bill = read([pulled({ billVersion: 1, needsReview: false, approval: stamp(1) })]);
        expect(bill.reviewStatus).toBe('OK');
        expect(bill.trustStatus).toBe('Verified');
        expect(billStamp(bill)).toBe('approved');
        expect(approvalIsDue(bill)).toBe(false);
        expect(bill.approval).toEqual(stamp(1));
    });

    it('corrected after it was approved: the stamp is for an older version and never carried to the new numbers', () => {
        const bill = read([pulled({ billVersion: 2, needsReview: true, reviewReason: 'High amount: >= 25000 INR', isCorrected: true, approval: stamp(1) })]);
        expect(billStamp(bill)).toBe('approvedOlder');
        expect(bill.trustStatus).toBe('Adjusted'); // not मंजूर: the stamp covers version 1 only
        expect(bill.reviewStatus).toBe('NeedsReview');
        expect(approvalIsDue(bill)).toBe(true);
    });

    it('a name the server did not send stays absent — never "unknown"', () => {
        const bill = read([pulled({ billVersion: 1, needsReview: false, approval: stamp(1, { approvedByName: null }) })]);
        expect(bill.approval?.approvedByName).toBeUndefined();
    });

    it('an older server (no new fields) reads exactly as before: isFlagged, no stamp, nothing to approve', () => {
        const bill = read([pulled({ isFlagged: true, flagReason: 'High amount: >= 25000 INR' })]);
        expect(bill.reviewStatus).toBe('NeedsReview');
        expect(bill.billVersion).toBeUndefined();
        expect(billStamp(bill)).toBe('none');
        expect(approvalIsDue(bill)).toBe(false); // no version from the server: nothing to approve yet
    });

    it('needsReview wins over a stale isFlagged on the same row', () => {
        const bill = read([pulled({ isFlagged: true, flagReason: 'old', billVersion: 1, needsReview: false, approval: stamp(1) })]);
        expect(bill.reviewStatus).toBe('OK');
        expect(bill.reviewReasons).toEqual([]);
    });

    it('a stamp that cannot be read is no stamp (never a guessed मंजूर)', () => {
        const bill = read([pulled({ billVersion: 1, needsReview: false, approval: stamp(0) })]);
        expect(bill.approval).toBeUndefined();
        expect(bill.trustStatus).toBe('Unverified');
    });
});

describe('the queued approval', () => {
    it('passes the contract, names the bill, its farm and the version on screen, and carries nothing else', () => {
        const payload = buildApprovePayload({ id: BILL, farmId: FARM, billVersion: 3 }, 'a1110000-0000-4000-8000-0000000000aa');
        expect(payload).toEqual({ approvalId: 'a1110000-0000-4000-8000-0000000000aa', costEntryId: BILL, farmId: FARM, billVersion: 3 });
        expect(ApproveCostEntryPayload.safeParse(payload).success).toBe(true);
    });

    it('a bill the server has not sent its version for cannot be approved', () => {
        expect(() => buildApprovePayload({ id: BILL, farmId: FARM, billVersion: undefined }, 'x')).toThrow();
    });

    it('is queued on the bill\'s farm and settles the parked "bill changed" row it answers', async () => {
        const parked = await db.mutationQueue.add({
            deviceId: 'd', clientRequestId: 'old', clientCommandId: 'old', mutationType: SyncMutationName.ApproveCostEntry,
            payload: { approvalId: 'a1110000-0000-4000-8000-0000000000bb', costEntryId: BILL, farmId: FARM, billVersion: 1 },
            status: 'REJECTED_USER_REVIEW', errorCode: BILL_VERSION_CONFLICT_CODE, createdAt: AT, updatedAt: AT, retryCount: 0,
        } as never) as number;

        const sent = await approveBill({ id: BILL, farmId: FARM, billVersion: 2 }, parked);

        const rows = await db.mutationQueue.where('mutationType').equals(SyncMutationName.ApproveCostEntry).toArray();
        const queued = rows.find(r => r.status === 'PENDING')!;
        expect(queued.payload).toEqual(sent);
        expect(queued.farmId).toBe(FARM);
        expect(rows.find(r => r.id === parked)?.status).toBe('REJECTED_DROPPED');
        expect(rows.some(r => r.mutationType === SyncMutationName.VerifyLog)).toBe(false);
    });
});

describe('what this phone still holds for its approvals (P10)', () => {
    const row = (clientRequestId: string, status: string, over: Record<string, unknown> = {}) => db.mutationQueue.add({
        deviceId: 'd', clientRequestId, clientCommandId: clientRequestId, mutationType: SyncMutationName.ApproveCostEntry,
        payload: { approvalId: clientRequestId, costEntryId: `bill-${clientRequestId}`, farmId: FARM, billVersion: 1 },
        status, createdAt: AT, updatedAt: AT, retryCount: 0, ...over,
    } as never);

    it('waiting, refused because the bill changed, refused otherwise; an applied one is the server\'s', async () => {
        await row('w', 'PENDING');
        await row('f', 'FAILED');
        await row('c', 'REJECTED_USER_REVIEW', { errorCode: BILL_VERSION_CONFLICT_CODE });
        await row('x', 'REJECTED_USER_REVIEW', { errorCode: 'ShramSafal.Forbidden' });
        await row('a', 'APPLIED');
        await row('b', 'PENDING', {
            payload: { approvalId: 'b', costEntryId: 'bill-b', farmId: FARM_B, billVersion: 1 },
        });

        const mine = await readBillApprovalOutbox(FARM, db);
        expect([...mine.pending].sort()).toEqual(['bill-f', 'bill-w']);
        expect([...mine.changed.keys()]).toEqual(['bill-c']);
        expect(mine.changed.get('bill-c')?.seenVersion).toBe(1);
        expect([...mine.refused.entries()]).toEqual([['bill-x', 'ShramSafal.Forbidden']]);

        const everyFarm = await readBillApprovalOutbox(null, db);
        expect(everyFarm.pending.has('bill-b')).toBe(true);
    });
});
