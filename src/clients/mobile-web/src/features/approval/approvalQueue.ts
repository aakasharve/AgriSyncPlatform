/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I28, lane L4b; founder D-3 / D-40) — THE ONE APPROVAL LIST.
 *
 * "One server-backed count per selected farm everywhere" (D-40 §1). Every door — the strip, आढावा, the
 * हजेरी page's तपासा, the dashboard's तपासायचं, a job card's linked record — reads THIS store, and the one review
 * sheet lists THIS store's records. The list is the server's (`GET /shramsafal/farms/{farm}/labour`, its `review`):
 * Draft / Confirmed records this person may act on, already narrowed by the server for his seat (MU-3), his plots
 * (MU-4) and each record's audience (PRV). The count is that list's length — records, never rows — and only for
 * someone the server says may confirm (`canConfirm`); nobody else is shown a मंजुरीसाठी number.
 *
 * Unknown is not none: until the server answered for THIS farm the state is `loading` / `unknown`, and no door may
 * say "मंजुरीसाठी नोंदी बाकी नाहीत" on it.
 *
 * "This record changed" (D-46 §3): a confirmation the server refused with `ShramSafal.LogVersion.Conflict` parks in
 * this phone's queue (`REJECTED_USER_REVIEW`, tail CONFLICT is permanent). This store reads those rows so the sheet
 * shows the new version beside what he saw, instead of leaving his मंजूर parked silently.
 */
import { fetchLabourData } from '../labour/data/labourClient';
import type { LabourData, ReviewItem } from '../labour/labour.types';
import { mutationQueue } from '../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../infrastructure/sync/SyncMutationCatalog';
import { ApprovalSeenStore } from '../../infrastructure/storage/ApprovalSeenStore';

export type ApprovalQueueStatus = 'idle' | 'loading' | 'known' | 'unknown';

/** A confirmation the server refused because the record had moved on since he saw it. */
export interface ApprovalConflict {
    rowId: number;
    logId: string;
    seenVersion: number | null;
}

export interface ApprovalQueueState {
    farmId: string | null;
    status: ApprovalQueueStatus;
    data: LabourData | null;
    fetchedAt: number | null;
    conflicts: readonly ApprovalConflict[];
}

/** The server code a stale confirmation is refused with (`ShramSafalErrors.LogChangedSinceReview`). */
export const VERSION_CONFLICT_CODE = 'ShramSafal.LogVersion.Conflict';
const VERIFY_V2 = SyncMutationName.VerifyLogV2;
const STALE_AFTER_MS = 30_000;

const EMPTY: ApprovalQueueState = { farmId: null, status: 'idle', data: null, fetchedAt: null, conflicts: [] };
const entries = new Map<string, ApprovalQueueState>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let focusLogId: string | null = null;

function emit(): void {
    listeners.forEach((l) => l());
}

function put(farmId: string, next: Partial<ApprovalQueueState>): void {
    const prev = entries.get(farmId) ?? { ...EMPTY, farmId };
    entries.set(farmId, { ...prev, ...next, farmId });
    emit();
}

export function subscribeApprovalQueue(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** The farm's state; the SAME object until it changes (safe for `useSyncExternalStore`). */
export function getApprovalQueue(farmId: string | null | undefined): ApprovalQueueState {
    if (!farmId) return EMPTY;
    return entries.get(farmId) ?? EMPTY;
}

/** May this person give the owner's confirmation here? The server's answer; an older server's labour flag. */
export function mayConfirmFrom(data: LabourData | null | undefined): boolean {
    if (!data) return false;
    return data.canConfirm ?? data.canManageLabour !== false;
}

/**
 * "मंजुरीसाठी N" — the records awaiting THIS person's मंजूर on THIS farm, or `null` when no number may be shown
 * (not read from the server yet, or he may not confirm).
 */
export function approvalCountOf(state: ApprovalQueueState): number | null {
    if (state.status !== 'known' || !state.data || !mayConfirmFrom(state.data)) return null;
    return state.data.review.length;
}

/** Any fresh read of the farm's labour page carries the same list: it refreshes every door at once. */
export function publishApprovalQueue(farmId: string, data: LabourData): void {
    put(farmId, { status: 'known', data, fetchedAt: Date.now() });
}

async function readVersionConflicts(): Promise<ApprovalConflict[]> {
    try {
        const rows = await mutationQueue.getRejectedUserReview();
        return rows
            .filter((r) => r.mutationType === VERIFY_V2 && r.errorCode === VERSION_CONFLICT_CODE && typeof r.id === 'number')
            .map((r) => {
                const payload = (r.payload ?? {}) as { logId?: unknown; logVersion?: unknown };
                return {
                    rowId: r.id as number,
                    logId: typeof payload.logId === 'string' ? payload.logId : '',
                    seenVersion: typeof payload.logVersion === 'number' ? payload.logVersion : null,
                };
            })
            .filter((c) => c.logId !== '');
    } catch {
        return [];
    }
}

/**
 * Reads the farm's list from the server (and this phone's parked "record changed" confirmations). Concurrent calls
 * for one farm share one request. A failed read keeps the last answer when there is one; with none it is `unknown`.
 */
export function refreshApprovalQueue(farmId: string | null | undefined): Promise<void> {
    if (!farmId) return Promise.resolve();
    const running = inflight.get(farmId);
    if (running) return running;
    const prev = getApprovalQueue(farmId);
    if (!prev.data) put(farmId, { status: 'loading' });
    const job = (async () => {
        const conflicts = await readVersionConflicts();
        try {
            // `today` is the lightest window; the review list itself is never windowed (server §8).
            const data = await fetchLabourData(farmId, 'today');
            put(farmId, { status: 'known', data, fetchedAt: Date.now(), conflicts });
        } catch {
            const now = getApprovalQueue(farmId);
            put(farmId, { status: now.data ? now.status : 'unknown', conflicts });
        } finally {
            inflight.delete(farmId);
        }
    })();
    inflight.set(farmId, job);
    return job;
}

/** Refresh only when the farm's answer is missing or older than half a minute. */
export function refreshApprovalQueueIfStale(farmId: string | null | undefined): Promise<void> {
    const state = getApprovalQueue(farmId);
    if (state.fetchedAt !== null && Date.now() - state.fetchedAt < STALE_AFTER_MS && state.status === 'known') {
        return Promise.resolve();
    }
    return refreshApprovalQueue(farmId);
}

/**
 * The parked confirmation is settled: he acted on the new version, or the record no longer waits for anyone's मंजूर.
 * The row leaves "needs you" (soft-dropped, never deleted — the queue keeps its history).
 */
export async function settleVersionConflict(farmId: string | null | undefined, rowId: number): Promise<void> {
    try {
        await mutationQueue.markRejectedDropped(rowId);
    } catch {
        // The row stays visible in the sync drawer: nothing is lost.
    }
    if (farmId) {
        const state = getApprovalQueue(farmId);
        put(farmId, { conflicts: state.conflicts.filter((c) => c.rowId !== rowId) });
    }
}

/** A door that opens the sheet on one record (a job card's linked record) names it here first. */
export function setApprovalFocus(logId: string | null): void {
    focusLogId = logId;
}

export function takeApprovalFocus(): string | null {
    const id = focusLogId;
    focusLogId = null;
    return id;
}

// ── What he saw, kept on this phone so "what changed" can be said (a disposable cache, never business truth) ──

export interface SeenFacts {
    version: number | null;
    count: number | null;
    task: string | null;
    plot: string | null;
    amount: number | null;
}

export function factsOf(item: ReviewItem): SeenFacts {
    return {
        version: typeof item.version === 'number' ? item.version : null,
        count: item.points.count ?? null,
        task: item.points.task || null,
        plot: item.plotScope === 'Farm' ? 'Farm' : (item.plot || null),
        amount: item.points.amount ?? null,
    };
}

export function rememberSeen(item: ReviewItem): void {
    ApprovalSeenStore.write(item.id, factsOf(item));
}

export function seenFactsOf(logId: string): SeenFacts | null {
    return ApprovalSeenStore.read<SeenFacts>(logId);
}

export function forgetSeen(logId: string): void {
    ApprovalSeenStore.remove(logId);
}

/** Test seam: forget every farm's answer. */
export function resetApprovalQueueForTests(): void {
    entries.clear();
    inflight.clear();
    focusLogId = null;
    emit();
}
