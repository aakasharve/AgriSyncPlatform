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
 *
 * Lane L4b fix round 1:
 *  - M-1: a parked conflict belongs to its record's farm (the farm stamped on the queued row); each farm's state holds
 *    only its own, so a read of one farm never touches another farm's;
 *  - H-2: each read also carries this farm's decisions still on this phone (`pendingDecisionIds`) and a read ticket
 *    taken when the read STARTED (`readTicket`), so the sheet hides a card only while its own send is pending and shows
 *    it again once a list read after the send still carries it;
 *  - L-4: what he saw is kept per user and farm, and dropped once the record is decided;
 *  - L-10: a failed refresh marks the older answer as not current (`lastReadFailed`);
 *  - L-8: a मंजूर sent from the one sheet is announced (`notifyApprovalSent`) so the हजेरी page reads its data again.
 */
import { fetchLabourData } from '../labour/data/labourClient';
import type { LabourData, ReviewItem } from '../labour/labour.types';
import { mutationQueue, queuedRowFarmId } from '../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../infrastructure/sync/SyncMutationCatalog';
import { ApprovalSeenStore } from '../../infrastructure/storage/ApprovalSeenStore';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { getSessionUserId } from '../../infrastructure/storage/AuthTokenStore';

export type ApprovalQueueStatus = 'idle' | 'loading' | 'known' | 'unknown';

/** A confirmation the server refused because the record had moved on since he saw it. */
export interface ApprovalConflict {
    rowId: number;
    logId: string;
    seenVersion: number | null;
    /** The farm stamped on the queued row (M-1); a row that names no farm belongs to none. */
    farmId: string | null;
}

export interface ApprovalQueueState {
    farmId: string | null;
    status: ApprovalQueueStatus;
    data: LabourData | null;
    fetchedAt: number | null;
    /** THIS farm's parked "record changed" confirmations. */
    conflicts: readonly ApprovalConflict[];
    /** H-2 — records of this farm whose मंजूर / शंका is still on this phone (not sent, or being sent). */
    pendingDecisionIds: readonly string[];
    /** H-2 — the ticket of the read that produced `data`, taken when that read started; null before any read. */
    readTicket: number | null;
    /** L-10 — the last attempt to read failed: `data` is an older answer, not "now". */
    lastReadFailed: boolean;
}

/** The server code a stale confirmation is refused with (`ShramSafalErrors.LogChangedSinceReview`). */
export const VERSION_CONFLICT_CODE = 'ShramSafal.LogVersion.Conflict';
const VERIFY_V2 = SyncMutationName.VerifyLogV2;
const DECISION_MUTATIONS: ReadonlySet<string> = new Set([SyncMutationName.VerifyLog, SyncMutationName.VerifyLogV2]);
/** A decision still on this phone: waiting to go, going, or failed and to be tried again. */
const OPEN_DECISION_STATUSES = ['PENDING', 'SENDING', 'FAILED'] as const;
const STALE_AFTER_MS = 30_000;

const EMPTY: ApprovalQueueState = {
    farmId: null, status: 'idle', data: null, fetchedAt: null, conflicts: [], pendingDecisionIds: [], readTicket: null,
    lastReadFailed: false,
};
const entries = new Map<string, ApprovalQueueState>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const sentListeners = new Set<(farmId: string) => void>();
let focusLogId: string | null = null;
let readTickets = 0;

/** H-2 — the latest read ticket handed out: a read whose ticket is above this one started after now. */
export function approvalReadTicket(): number {
    return readTickets;
}

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

/**
 * Any fresh read of the farm's labour page carries the same list: it refreshes every door at once. Its ticket is taken
 * at publish (the page's read began a little earlier); the sheet's own read after a send is the one H-2 relies on.
 */
export function publishApprovalQueue(farmId: string, data: LabourData): void {
    readTickets += 1;
    put(farmId, { status: 'known', data, fetchedAt: Date.now(), readTicket: readTickets, lastReadFailed: false });
}

/** M-1 — this farm's parked "record changed" confirmations only. */
async function readVersionConflicts(farmId: string): Promise<ApprovalConflict[]> {
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
                    farmId: queuedRowFarmId(r) ?? null,
                };
            })
            .filter((c) => c.logId !== '' && c.farmId === farmId);
    } catch {
        return [];
    }
}

/** H-2 — the records of this farm whose मंजूर / शंका is still on this phone. An unreadable queue names none. */
async function readOpenDecisions(farmId: string): Promise<string[]> {
    try {
        const rows = await getDatabase().mutationQueue.where('status').anyOf([...OPEN_DECISION_STATUSES]).toArray();
        const ids = rows
            .filter((r) => DECISION_MUTATIONS.has(r.mutationType) && queuedRowFarmId(r) === farmId)
            .map((r) => {
                const payload = (r.payload ?? {}) as { logId?: unknown; dailyLogId?: unknown };
                if (typeof payload.logId === 'string') return payload.logId;
                return typeof payload.dailyLogId === 'string' ? payload.dailyLogId : '';
            })
            .filter((id) => id !== '');
        return Array.from(new Set(ids));
    } catch {
        return [];
    }
}

/**
 * L-4 — what he saw is needed only while the record still waits for him or something of his is parked or on its way
 * for it; once the server's list no longer carries it (decided), its entry goes.
 */
function forgetDecided(farmId: string, data: LabourData, conflicts: readonly ApprovalConflict[], pending: readonly string[]): void {
    const userId = getSessionUserId();
    if (!userId) return;
    const keep = new Set<string>([...data.review.map((r) => r.id), ...conflicts.map((c) => c.logId), ...pending]);
    ApprovalSeenStore.logIdsOf(userId, farmId)
        .filter((id) => !keep.has(id))
        .forEach((id) => ApprovalSeenStore.remove(userId, farmId, id));
}

/**
 * Reads the farm's list from the server (and this phone's parked "record changed" confirmations). Concurrent calls
 * for one farm share one request. A failed read keeps the last answer when there is one; with none it is `unknown`.
 * `afterNow` (H-2, after a send): a read already running started before the send, so a NEW read follows it.
 */
export function refreshApprovalQueue(farmId: string | null | undefined, options: { afterNow?: boolean } = {}): Promise<void> {
    if (!farmId) return Promise.resolve();
    const running = inflight.get(farmId);
    if (running && options.afterNow) return running.then(() => refreshApprovalQueue(farmId));
    if (running) return running;
    const prev = getApprovalQueue(farmId);
    if (!prev.data) put(farmId, { status: 'loading' });
    readTickets += 1;
    const ticket = readTickets;
    const job = (async () => {
        const conflicts = await readVersionConflicts(farmId);
        const pendingDecisionIds = await readOpenDecisions(farmId);
        // An answer that STARTED later may have landed first (another door's read, the labour page's publish): this
        // older read then neither replaces it nor marks it stale.
        const newerLanded = () => (getApprovalQueue(farmId).readTicket ?? 0) > ticket;
        try {
            // `today` is the lightest window; the review list itself is never windowed (server §8).
            const data = await fetchLabourData(farmId, 'today');
            if (!newerLanded()) {
                put(farmId, {
                    status: 'known', data, fetchedAt: Date.now(), conflicts, pendingDecisionIds, readTicket: ticket, lastReadFailed: false,
                });
                forgetDecided(farmId, data, conflicts, pendingDecisionIds);
            }
        } catch {
            if (!newerLanded()) {
                const now = getApprovalQueue(farmId);
                put(farmId, { status: now.data ? now.status : 'unknown', conflicts, pendingDecisionIds, lastReadFailed: true });
            }
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

/** L-8 — a मंजूर / शंका from the one sheet was sent for this farm: pages that show its records read them again. */
export function notifyApprovalSent(farmId: string): void {
    sentListeners.forEach((l) => l(farmId));
}

export function onApprovalSent(listener: (farmId: string) => void): () => void {
    sentListeners.add(listener);
    return () => { sentListeners.delete(listener); };
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

/** L-4 — kept for the signed-in user on this farm only; nothing is kept without both. */
export function rememberSeen(item: ReviewItem, farmId: string | null | undefined): void {
    const userId = getSessionUserId();
    if (userId && farmId) ApprovalSeenStore.write(userId, farmId, item.id, factsOf(item));
}

export function seenFactsOf(logId: string, farmId: string | null | undefined): SeenFacts | null {
    const userId = getSessionUserId();
    return userId && farmId ? ApprovalSeenStore.read<SeenFacts>(userId, farmId, logId) : null;
}

export function forgetSeen(logId: string, farmId: string | null | undefined): void {
    const userId = getSessionUserId();
    if (userId && farmId) ApprovalSeenStore.remove(userId, farmId, logId);
}

/** Test seam: forget every farm's answer. */
export function resetApprovalQueueForTests(): void {
    entries.clear();
    inflight.clear();
    sentListeners.clear();
    focusLogId = null;
    emit();
}
