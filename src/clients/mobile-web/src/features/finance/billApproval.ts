/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who
 * and when"). A bill's मंजूर on the phone: who may give it, where a bill stands, the queued approval and what this phone
 * still holds for it.
 *
 *  - WHO: the server's own rule (`ApproveCostEntryHandler`) — the farm's primary account holder, or a seat holding
 *    "पैशांच्या नोंदी तपासणे व दुरुस्त करणे" (ReviewMoney), read from `/me/context`; fail closed when the server sent no
 *    list (the payout check's rule, `payoutCheckWords.ts`). Everyone else never sees the action. Never a reviewer's OWN bill
 *    (founder C3 = C, 2026-11-23): that one waits for the owner or another reviewer, and the line says so.
 *  - WHERE A BILL STANDS: approved for the version it is at now; approved for an OLDER version (corrected since: the stamp
 *    is never carried to the new numbers); or not approved.
 *  - THE APPROVAL is queued (`approve_cost_entry`) so it works with no internet (P10); the server decides when it arrives.
 *    It names the version he SAW; a bill that changed since is refused with the L4b exact-version code, the row parks, and
 *    the page shows the new version so he looks at it first.
 *
 * A bill's मंजूर is money review — separate from a work record's मंजूर (D-40: "मंजुरी म्हणजे कामाच्या नोंदीची खात्री.
 * पैसे दिल्याची नोंद वेगळी आहे.").
 */
import { v4 as uuidv4 } from 'uuid';
import type { MeFarm } from '../../core/session/MeContextService';
import { AUTHORITY, holdsAuthority, isPrimaryAccountHolderRole } from '../../core/session/farmAuthorities';
import type { AgriLogDatabase } from '../../infrastructure/storage/DexieDatabase';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../infrastructure/sync/SyncMutationCatalog';
import type { MoneyEvent } from './finance.types';
import type { FarmAccessScopeDto } from '../../infrastructure/api/accessScopeDtos';

/** The server code a stale approval is refused with — the L4b exact-version code (`ShramSafalErrors.LogChangedSinceReview`). */
export const BILL_VERSION_CONFLICT_CODE = 'ShramSafal.LogVersion.Conflict';

/**
 * lane BILL-1b (founder D-105 (b)) — the server code a change to an APPROVED bill's price is refused with when the changer is
 * not the main owner (`ShramSafalErrors.BillPriceLockedAfterApproval`). Three segments, tail CONFLICT: every phone already
 * parks such a row where its owner sees it (P10, P11).
 */
export const BILL_PRICE_LOCKED_CODE = 'ShramSafal.BillPrice.Conflict';

/** May this seat approve bills on this farm? The server's rule, fail closed. */
export function mayApproveBills(farm: Pick<MeFarm, 'role' | 'authorities'> | null | undefined): boolean {
    return isPrimaryAccountHolderRole(farm?.role) || holdsAuthority(farm, AUTHORITY.reviewMoney);
}

/**
 * fix round 1 (review L4) — may this seat approve THIS bill? The farm-level rule, and for a chosen-plots seat the bill's plot:
 * his own bill on a plot he does not cover reaches him (D-28) but the server refuses its approval, so no button is drawn for
 * it. A farm-wide bill reaches such a seat only when he made it, and he may approve that one. Every other seat: the farm rule.
 */
export function mayApproveThisBill(
    farm: Pick<MeFarm, 'role' | 'authorities'> | null | undefined,
    scope: Pick<FarmAccessScopeDto, 'plotScope' | 'plotIds' | 'reviewerMayApproveOwnBill'> | null | undefined,
    bill: Pick<MoneyEvent, 'plotId' | 'createdByUserId'>,
    myUserId: string | null | undefined,
): boolean {
    return billApprovalSeat(farm, scope, bill, myUserId) === 'may';
}

/**
 * spec: plr-d10-founder-answers-2026-11-23 — founder C3 = C: "For now it works like A: nobody approves his own bill, the owner may. A
 * switch per farm comes after 3 December." The server's ONE named check (`BillApprovalRules.ReviewerMayApproveOwnBill`), mirrored so
 * the phone never draws a button the server can only refuse (P5).
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-177, founder 27 Nov B1.4) - the switch is now PER FARM: this constant is the DEFAULT
 * (off) when the farm says nothing; the farm's own value comes on the pull (`accessScopes[].reviewerMayApproveOwnBill`, only when on) and decides.
 */
export const REVIEWER_MAY_APPROVE_OWN_BILL = false;

/** The server code a reviewer's approval of his own bill is refused with (`ShramSafalErrors.OwnBillApprovalForbidden`). */
export const OWN_BILL_REFUSED_CODE = 'ShramSafal.OwnBillApproval.Forbidden';

/** May this seat approve this bill: yes; no; or not HIS OWN bill (it waits for the owner or another reviewer). */
export type BillApprovalSeat = 'may' | 'ownBill' | 'no';

/**
 * The server's whole rule for one bill: the farm rule, the chosen plots (review L4), and his own bill (C3 = C) - the primary account
 * holder may approve his own, a reviewer may not. Who he is comes from the signed-in person; when the phone cannot say, a reviewer
 * gets no button (fail closed: the bill might be his own).
 */
export function billApprovalSeat(
    farm: Pick<MeFarm, 'role' | 'authorities'> | null | undefined,
    scope: Pick<FarmAccessScopeDto, 'plotScope' | 'plotIds' | 'reviewerMayApproveOwnBill'> | null | undefined,
    bill: Pick<MoneyEvent, 'plotId' | 'createdByUserId'>,
    myUserId: string | null | undefined,
): BillApprovalSeat {
    if (!mayApproveBills(farm)) return 'no';
    if (scope?.plotScope === 'ChosenPlots' && Array.isArray(scope.plotIds) && bill.plotId && !scope.plotIds.includes(bill.plotId)) return 'no';
    // repair D-177: the farm's own switch (only when the server says it is on), else the default - off
    const farmAllows = scope?.reviewerMayApproveOwnBill === true || REVIEWER_MAY_APPROVE_OWN_BILL;
    if (isPrimaryAccountHolderRole(farm?.role) || farmAllows) return 'may';
    if (!myUserId) return 'no';
    return bill.createdByUserId === myUserId ? 'ownBill' : 'may';
}

export type BillStamp = 'approved' | 'approvedOlder' | 'none';

/** Where the bill stands: approved for its current version, approved for an older one, or not approved. */
export function billStamp(event: Pick<MoneyEvent, 'approval' | 'billVersion'>): BillStamp {
    if (!event.approval) return 'none';
    if (event.billVersion === undefined) return 'none';
    return event.approval.billVersion === event.billVersion ? 'approved' : 'approvedOlder';
}

/**
 * Can a मंजूर be sent for this bill now? Only a bill the server has (it carries its version) and that no stamp covers at that
 * version. An entry still on this phone, or one from an older server, carries no version: nothing to approve yet.
 */
export function approvalIsDue(event: Pick<MoneyEvent, 'approval' | 'billVersion'>): boolean {
    return event.billVersion !== undefined && billStamp(event) !== 'approved';
}

export interface ApproveCostEntryPayload {
    approvalId: string;
    costEntryId: string;
    farmId: string;
    billVersion: number;
}

/** What this phone still holds for its approvals on one farm (P10: unsent intent, shown as such). */
export interface BillApprovalOutbox {
    /** Bills whose मंजूर is waiting to go, going, or will be tried again. */
    pending: ReadonlySet<string>;
    /** Bills whose मंजूर the server refused because the bill changed since: the version he saw, and the parked row. */
    changed: ReadonlyMap<string, { rowId: number; seenVersion: number }>;
    /** Bills whose मंजूर the server refused for another reason (its code). */
    refused: ReadonlyMap<string, string>;
}

export const EMPTY_OUTBOX: BillApprovalOutbox = { pending: new Set(), changed: new Map(), refused: new Map() };

const OPEN_STATUSES = new Set(['PENDING', 'SENDING', 'FAILED']);

/**
 * The approvals the server has not taken — of one farm, or of every farm when `farmId` is null (a bill id is unique, so a
 * page listing bills of several farms reads them all at once). An unreadable queue names none.
 */
export async function readBillApprovalOutbox(
    farmId: string | null,
    db: AgriLogDatabase = getDatabase(),
): Promise<BillApprovalOutbox> {
    try {
        const rows = await db.mutationQueue.where('mutationType').equals(SyncMutationName.ApproveCostEntry).toArray();
        const pending = new Set<string>();
        const changed = new Map<string, { rowId: number; seenVersion: number }>();
        const refused = new Map<string, string>();
        for (const row of rows) {
            const payload = row.payload as Partial<ApproveCostEntryPayload> | undefined;
            if (!payload?.costEntryId || (farmId !== null && payload.farmId !== farmId)) continue;
            if (OPEN_STATUSES.has(row.status)) {
                pending.add(payload.costEntryId);
            } else if (row.status === 'REJECTED_USER_REVIEW') {
                if (row.errorCode === BILL_VERSION_CONFLICT_CODE && typeof row.id === 'number') {
                    changed.set(payload.costEntryId, { rowId: row.id, seenVersion: payload.billVersion ?? 0 });
                } else {
                    refused.set(payload.costEntryId, row.errorCode ?? '');
                }
            }
        }
        return { pending, changed, refused };
    } catch {
        return EMPTY_OUTBOX;
    }
}

/** The payload exactly as the contract takes it (`approve_cost_entry.zod.ts`); the stamp id is made here. */
export function buildApprovePayload(bill: Pick<MoneyEvent, 'id' | 'farmId' | 'billVersion'>, approvalId: string): ApproveCostEntryPayload {
    if (bill.billVersion === undefined) {
        throw new Error('approve_cost_entry: a bill the server has not sent its version for cannot be approved yet.');
    }
    return { approvalId, costEntryId: bill.id, farmId: bill.farmId, billVersion: bill.billVersion };
}

/**
 * Queues one मंजूर for the version of the bill on screen. A refusal parked for this bill because it changed is settled
 * by it (the reviewer is approving the NEW version now): the old row leaves "needs you" (soft-dropped, never deleted).
 */
export async function approveBill(
    bill: Pick<MoneyEvent, 'id' | 'farmId' | 'billVersion'>,
    settleChangedRowId?: number,
): Promise<ApproveCostEntryPayload> {
    const payload = buildApprovePayload(bill, uuidv4());
    const clientRequestId = `${SyncMutationName.ApproveCostEntry}:${payload.costEntryId}:${payload.approvalId}`;
    await mutationQueue.enqueue(SyncMutationName.ApproveCostEntry, payload, { clientRequestId, clientCommandId: clientRequestId });
    if (typeof settleChangedRowId === 'number') {
        try {
            await mutationQueue.markRejectedDropped(settleChangedRowId);
        } catch {
            // The parked row stays visible in the sync drawer: nothing is lost.
        }
    }
    return payload;
}
