/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF2 fix pass, review B002; widened by lane OF-S) — did the
 * server REFUSE a change he saved for this entry? Read from the sync queue's own rows for that entry (the same evidence
 * rule as `useLogSyncState`): parked for review, dropped, or failed past the retry cap. The "बदला" screen then says so
 * honestly, in plain words — this is THE surface for a refused queued change of one entry; there is no second one.
 *
 *   - a content change (`revise_log_content`): it stays on this phone only, and is said to;
 *   - a move of its plot / day (`move_daily_log`) or a worker-count change (`correct_labour_assignment`), lane OF-S: the
 *     entry is put back to the server's version (the refusal no longer holds it from the pull, `pendingMutations.ts`,
 *     and the worker asks for the server's records again, `logsRebuildMarker.ts`), and the plain reason is said.
 */
import { useEffect, useState } from 'react';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { MAX_AUTO_RETRY_COUNT } from '../../../../infrastructure/sync/retryCap';
import { missingMoneyIdsIn, namedMoneyRowsOfRecord } from '../../../../infrastructure/sync/MutationDependency';
import { readHeldMoney } from '../../../finance/heldMoney';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { correctionWords } from './correctionWords';

/** Which change was refused. */
export type RefusedKind = 'revision' | 'move' | 'workers';

/**
 * Why, as far as the server's code says (anything else claims no reason). Lane OF-S fix pass 2 (item 9): what is tied
 * to the entry has ONE reason per cause — हजेरी, a job card, money shared out across plots, money not found — and none
 * of them tells him to change something first when nothing he can do would change it.
 */
export type RefusedReason =
    | 'stale' | 'futureDay' | 'noSeason' | 'attendance' | 'jobCard' | 'moneyShared' | 'moneyNotFound' | 'notAllowed' | 'other'
    // fix passes 3–4 (R2-3, R3-3) — money not found, said as it really stands on THIS phone: kept here (and how to send
    // it, or that there is no way), removed for good, waiting for his review, or stuck at its retry limit. (R2-1, R3-4) —
    // the server never held the entry's details as it was created (an older app version, or details that did not arrive).
    | 'moneyKept' | 'moneyKeptStuck' | 'moneyRemoved' | 'moneyNeedsReview' | 'moneyStuck' | 'detailsNotHeld'
    // Lane OF-M fix pass 3 (call 1) — an edit that changed a price, from someone who neither made the entry nor checks money.
    | 'pricesNotYours';

/** `at` — when the refused change was made (its queue row's time), so the most recent of several can be shown. */
export interface RefusedChange { kind: RefusedKind; reason: RefusedReason; at?: string }

const KIND_OF: Readonly<Record<string, RefusedKind>> = {
    [SyncMutationName.ReviseLogContent]: 'revision',
    [SyncMutationName.MoveDailyLog]: 'move',
    [SyncMutationName.CorrectLabourAssignment]: 'workers',
};

/** The server's full refusal code → the reason he is told (lane OF-S codes; `ShramSafalErrors`). */
export function refusalReasonOf(errorCode: string | undefined): RefusedReason {
    switch (errorCode) {
        case 'ShramSafal.LogMove.Conflict':
        case 'ShramSafal.LabourCorrection.Conflict':
        case 'ShramSafal.LogContent.Conflict':
            return 'stale';
        case 'ShramSafal.LogDateInFuture.InvalidCommand':
            return 'futureDay';
        case 'ShramSafal.LogMoveNoCropCycle.InvalidCommand':
            return 'noSeason';
        case 'ShramSafal.LogMoveAttendance.Conflict':
            return 'attendance';
        case 'ShramSafal.LogMoveJobCard.Conflict':
            return 'jobCard';
        case 'ShramSafal.LogMoveMoneyShared.Conflict':
            return 'moneyShared';
        case 'ShramSafal.LogMoveMoneyNotFound.Conflict':
            return 'moneyNotFound';
        case 'ShramSafal.LogMoveDetailsNotHeld.Conflict':
            return 'detailsNotHeld';
        case 'ShramSafal.LogContentPrices.Conflict':
            return 'pricesNotYours';
        case 'ShramSafal.Forbidden':
            return 'notAllowed';
        default:
            return 'other';
    }
}

/**
 * Lane OF-S fix 1 (B011) — the plain lines for a refused change, in the farmer's language (one language at a time): what
 * did not happen, then why. A content change keeps its own screen words (it stays on this phone); a move and a worker
 * count were put back as the server has it. Empty when there is nothing plain to say.
 */
export function refusalLines(refused: RefusedChange, language: string | null | undefined): string[] {
    const words = correctionWords(language);
    // A content change keeps its screen words; a price change refused (lane OF-M fix pass 3) also says who may.
    if (refused.kind === 'revision') {
        return refused.reason === 'pricesNotYours' ? [words.serverRefused, words.refusedReason.pricesNotYours] : [words.serverRefused];
    }
    const head = refused.kind === 'move' ? words.refusedMove : words.refusedWorkers;
    return [head, words.refusedReason[refused.reason]].filter(line => line.length > 0);
}

/**
 * Lane OF-S fix 1 (B011) — the plain reason for a refused queued change on the app's conflict page, or `undefined` when
 * this module has nothing to add (the page keeps its own hints). Covers a move, a worker count and a create refused
 * because its day has not come.
 */
export function refusalHint(mutationType: string, errorCode: string | undefined, language: string | null | undefined): string | undefined {
    const reason = refusalReasonOf(errorCode);
    const kind = KIND_OF[mutationType];
    if (kind === 'move' || kind === 'workers') return refusalLines({ kind, reason }, language).join(' ');
    if (kind === 'revision' && reason === 'pricesNotYours') return correctionWords(language).refusedReason.pricesNotYours;
    if (mutationType === SyncMutationName.CreateDailyLog && reason === 'futureDay') {
        return correctionWords(language).refusedReason.futureDay;
    }
    return undefined;
}

/** One refused queue row, as much of it as the reason needs (`lastError`: the server's own message, lane OF-M R4-1). */
interface RefusedRow { mutationType: string; errorCode?: string; payload: unknown; lastError?: string }

/**
 * Lane OF-S fix passes 3–4 (R2-3, R3-3) — the reason for a refused row as it REALLY stands. A move refused because its
 * money was not found is looked up in this phone's own money rows for that record (read from its own store), and — lane
 * OF-M R4-1 — only the rows of the money the refusal NAMES (`[money:<id>]` in its message), so the words are about the
 * line whose money is really missing, never another line's row (all of the record's rows when the refusal names none):
 *   - a money row DISCARDED (gone for good) → this work can never be moved;
 *   - a money row waiting for his review → look at it on the sync page first (it can still be sent);
 *   - a money row stuck at its retry limit → send it again from the sync page;
 *   - money kept on this phone → where to send it (or, its plot not on the server, that it cannot be moved);
 *   - otherwise the server's own words.
 */
export async function refusalReasonForRow(row: RefusedRow): Promise<RefusedReason> {
    const reason = refusalReasonOf(row.errorCode);
    if (reason !== 'moneyNotFound' || row.mutationType !== SyncMutationName.MoveDailyLog) return reason;
    const dailyLogId = String((row.payload as { dailyLogId?: unknown } | null)?.dailyLogId ?? '');
    if (!dailyLogId) return reason;
    const named = missingMoneyIdsIn(row.lastError);
    const moneyRows = await namedMoneyRowsOfRecord(dailyLogId, named);
    const keys = new Set(moneyRows.map(money => money.clientRequestId));
    const ids = new Set(moneyRows.map(money => money.id));
    const [rows, held] = await Promise.all([
        getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.AddCostEntry).toArray(),
        readHeldMoney(),
    ]);
    const mine = rows.filter(r => keys.has(r.clientRequestId));
    if (mine.some(r => r.status === 'REJECTED_DROPPED')) return 'moneyRemoved';
    if (mine.some(r => r.status === 'REJECTED_USER_REVIEW')) return 'moneyNeedsReview';
    if (mine.some(r => r.status === 'FAILED' && r.retryCount >= MAX_AUTO_RETRY_COUNT)) return 'moneyStuck';
    // Money kept on this phone: the named money's, or (when the refusal names none) any of this record's.
    const kept = held.filter(record => ids.has(record.costEntryId) || (named.length === 0 && record.payload?.logId === dailyLogId));
    if (kept.some(record => record.reason === 'plot-not-on-server')) return 'moneyKeptStuck';
    return kept.length > 0 ? 'moneyKept' : reason;
}

/** `refusalHint` for one refused row, its reason read as it really stands (`refusalReasonForRow`). */
export async function refusalHintForRow(row: RefusedRow, language: string | null | undefined): Promise<string | undefined> {
    const kind = KIND_OF[row.mutationType];
    if (kind !== 'move') return refusalHint(row.mutationType, row.errorCode, language);
    return refusalLines({ kind, reason: await refusalReasonForRow(row) }, language).join(' ');
}

/**
 * A change to this entry the server refused, and that is not since replaced by an accepted change OF THE SAME KIND.
 * The most recent such refusal when there are several. `null` = none.
 */
export async function readRefusedChange(logId: string): Promise<RefusedChange | null> {
    try {
        const rows = await getDatabase().mutationQueue.where('mutationType').anyOf(Object.keys(KIND_OF)).toArray();
        const mine = rows
            .filter(r => String((r.payload as { dailyLogId?: unknown } | null)?.dailyLogId ?? '') === logId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const latestByKind = new Map<string, (typeof mine)[number]>();
        for (const row of mine) latestByKind.set(row.mutationType, row);
        const refused = [...latestByKind.values()]
            .filter(r => r.status === 'REJECTED_USER_REVIEW' || r.status === 'REJECTED_DROPPED'
                || (r.status === 'FAILED' && r.retryCount >= MAX_AUTO_RETRY_COUNT))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .at(-1);
        return refused
            ? { kind: KIND_OF[refused.mutationType], reason: await refusalReasonForRow(refused), at: refused.createdAt }
            : null;
    } catch (error) {
        // No evidence either way: no claim — but never silently (the queue could not be read).
        console.warn('refusedRevision: the sync queue could not be read', error);
        return null;
    }
}

export function useRefusedChange(
    logId: string | undefined,
    read: (id: string) => Promise<RefusedChange | null> = readRefusedChange,
): RefusedChange | null {
    return useRefusedChangeOf(logId ? [logId] : [], read);
}

/**
 * Lane OF-S fix 1 (B011) — the same, for the entries of one recording (the result screen), read again whenever
 * `refreshKey` changes (the app's last sync), so a refusal that arrives while the screen is open is shown there. The
 * MOST RECENT refusal among them (fix pass 2: by when the refused change was made, never by the entries' order).
 */
export function useRefusedChangeOf(
    logIds: readonly string[],
    read: (id: string) => Promise<RefusedChange | null> = readRefusedChange,
    refreshKey?: unknown,
): RefusedChange | null {
    const [refused, setRefused] = useState<RefusedChange | null>(null);
    const key = logIds.join(',');
    useEffect(() => {
        let alive = true;
        const ids = key ? key.split(',') : [];
        if (ids.length === 0) { setRefused(null); return undefined; }
        void Promise.all(ids.map(id => read(id))).then(all => {
            if (alive) setRefused(mostRecent(all));
        });
        return () => { alive = false; };
    }, [key, read, refreshKey]);
    return refused;
}

/** The refusal made last; one with no time counts as the oldest, and on a tie the first entry's is kept. */
function mostRecent(all: ReadonlyArray<RefusedChange | null>): RefusedChange | null {
    let latest: RefusedChange | null = null;
    for (const refused of all) {
        if (refused && (latest === null || (refused.at ?? '') > (latest.at ?? ''))) latest = refused;
    }
    return latest;
}
