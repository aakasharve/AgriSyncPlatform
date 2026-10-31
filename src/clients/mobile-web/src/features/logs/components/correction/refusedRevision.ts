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
import { correctionWords } from './correctionWords';

/** Which change was refused. */
export type RefusedKind = 'revision' | 'move' | 'workers';

/**
 * Why, as far as the server's code says (anything else claims no reason). Lane OF-S fix pass 2 (item 9): what is tied
 * to the entry has ONE reason per cause — हजेरी, a job card, money shared out across plots, money not found — and none
 * of them tells him to change something first when nothing he can do would change it.
 */
export type RefusedReason =
    | 'stale' | 'futureDay' | 'noSeason' | 'attendance' | 'jobCard' | 'moneyShared' | 'moneyNotFound' | 'notAllowed' | 'other';

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
    if (refused.kind === 'revision') return [words.serverRefused];
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
    if (mutationType === SyncMutationName.CreateDailyLog && reason === 'futureDay') {
        return correctionWords(language).refusedReason.futureDay;
    }
    return undefined;
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
            ? { kind: KIND_OF[refused.mutationType], reason: refusalReasonOf(refused.errorCode), at: refused.createdAt }
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
