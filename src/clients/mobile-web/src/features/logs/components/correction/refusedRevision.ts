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
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

/** Which change was refused. */
export type RefusedKind = 'revision' | 'move' | 'workers';

/** Why, as far as the server's code says (anything else claims no reason). */
export type RefusedReason = 'stale' | 'futureDay' | 'noSeason' | 'linked' | 'notAllowed' | 'other';

export interface RefusedChange { kind: RefusedKind; reason: RefusedReason }

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
        case 'ShramSafal.LogMoveLinkedRecords.Conflict':
            return 'linked';
        case 'ShramSafal.Forbidden':
            return 'notAllowed';
        default:
            return 'other';
    }
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
        return refused ? { kind: KIND_OF[refused.mutationType], reason: refusalReasonOf(refused.errorCode) } : null;
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
    const [refused, setRefused] = useState<RefusedChange | null>(null);
    useEffect(() => {
        let alive = true;
        if (!logId) { setRefused(null); return undefined; }
        void read(logId).then(r => { if (alive) setRefused(r); });
        return () => { alive = false; };
    }, [logId, read]);
    return refused;
}
