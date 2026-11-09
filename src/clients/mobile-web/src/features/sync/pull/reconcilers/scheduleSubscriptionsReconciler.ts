/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2, founder D-32, register F09) - the SERVER WINS on download.
 *
 * The pull carries `scheduleSubscriptions`: each plot's chosen schedules, every state, changed since this phone's cursor. They
 * are kept in Dexie `scheduleSubscriptions` (schema v27) and `resolvePlotSchedule` reads a plot's Active rows first, so every
 * phone of the farm follows the same schedules and a download can never put the crop-type default over a choice.
 *
 * What this step does, in order:
 *   1. every row the server sent replaces the phone's copy of that subscription (by id; the phone's `pending` mark goes);
 *   2. spec: plr-d10 lane L8b-3 (R6, D-76) - the pull's `plotMainSchedules` (FULL on every pull) says which followed schedule is the
 *      मुख्य one of each plot-season: the phone marks its own rows from it (`isMain`) and never works it out; a key that is absent
 *      (an older server) leaves the marks as they are;
 *   3. then this phone's unanswered choices are swept (`sweepPendingScheduleChoices`).
 * Runs on every pull, also when the pull carries no rows, because a refusal can arrive after the row it lost to.
 * An older server sends no key: nothing is received, the sweep still runs, nothing is lost (P11).
 */
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../../infrastructure/sync/MutationQueue';
import type { ScheduleSubscriptionRow } from '../../../../infrastructure/storage/scheduleSubscriptionRow';
import { AbandonScheduleCommand, AdoptScheduleCommand, MigrateScheduleCommand } from '../../../../application/usecases/sync/ScheduleChoiceCommands';
import type { PlotMainScheduleDto } from '../../../../infrastructure/api/scheduleSubscriptionDtos';
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import { rowFromDto } from '../../../scheduler/schedulePage/scheduleSubscriptions';

/** The statuses that mean "this request is still on its way to the server" (a parked or dropped one is not). */
const WAITING = new Set(['PENDING', 'SENDING', 'FAILED']);

/** The request a pending row was queued under (its adopt, or its switch), if the queue still has it. */
async function requestOf(db: AgriLogDatabase, deviceId: string, subscriptionId: string) {
    for (const clientRequestId of [AdoptScheduleCommand.requestIdFor(subscriptionId), MigrateScheduleCommand.requestIdFor(subscriptionId)]) {
        const row = await db.mutationQueue.where('[deviceId+clientRequestId]').equals([deviceId, clientRequestId]).first();
        if (row) return row;
    }
    return undefined;
}

const codeTail = (code: string | undefined): string => (code ?? '').split('.').pop()?.toUpperCase() ?? '';

/** The statuses that mean the server REFUSED the request or it was given up on (a parked or dropped one). */
const REFUSED = new Set(['REJECTED_USER_REVIEW', 'REJECTED_DROPPED']);

/**
 * This phone's unanswered choices against what the server holds (B001, B003, B008; rewritten for 3 + 1, lane L8b-3: a plot-season may
 * hold several Active rows, so "the server holds a DIFFERENT row" no longer means "the server's choice stands"):
 *   - a request still waiting keeps its pending row (his intent is shown until the server answers, P10);
 *   - once it is not waiting, a pending row goes ONLY when (a) the server holds an Active row of the SAME schedule on that plot (both
 *     phones agree: the pending row is redundant; a `ScheduleAlreadyAdopted` refusal of it is no conflict and is dropped from the
 *     conflict page too), or (b) its request was refused or given up AND the plot-season already follows something on the server (the
 *     server's list stands; the parked request keeps its words). A refusal on a plot-season with NO server row keeps the pending row
 *     visible (P10: a refusal, e.g. no authority, never makes his choice vanish);
 *   - a request the server applied keeps its pending row until the server's own row (under the same id) replaces it on a pull;
 *   - a row with no request at all (kept on this phone only: no season on the server yet) is kept;
 *   - a schedule this phone let go (`ending`) whose request was refused or given up is drawn again (the mark clears).
 */
export async function sweepPendingScheduleChoices(db: AgriLogDatabase): Promise<void> {
    const deviceId = mutationQueue.getDeviceId();
    const all = await db.scheduleSubscriptions.toArray();
    const serverActive = all.filter(r => r.pending !== true && r.state === 'Active');
    for (const row of all) {
        if (row.pending === true) {
            const request = await requestOf(db, deviceId, row.id);
            if (!request || WAITING.has(request.status)) continue;
            // fix 1 (L004): a request this phone GAVE UP on (REJECTED_DROPPED) is never going to the server: its pending row goes, whatever the
            // server holds. A refused one (REJECTED_USER_REVIEW) keeps the existing rule below.
            if (request.status === 'REJECTED_DROPPED') {
                await db.scheduleSubscriptions.delete(row.id);
                continue;
            }
            const ofSeason = serverActive.filter(s => s.plotId === row.plotId && (!row.cropCycleId || s.cropCycleId === row.cropCycleId) && s.id !== row.id);
            const sameOnServer = ofSeason.find(s => s.templateId === row.templateId);
            const refused = REFUSED.has(request.status);
            if (!sameOnServer && !(refused && ofSeason.length > 0)) continue;
            if (request.id !== undefined && request.status === 'REJECTED_USER_REVIEW'
                && codeTail(request.errorCode) === 'SCHEDULEALREADYADOPTED' && sameOnServer) {
                await db.mutationQueue.update(request.id, { status: 'REJECTED_DROPPED' });
            }
            await db.scheduleSubscriptions.delete(row.id);
        } else if (row.ending === true) {
            const request = await db.mutationQueue
                .where('[deviceId+clientRequestId]').equals([deviceId, AbandonScheduleCommand.requestIdFor(row.id)]).first();
            if (!request || REFUSED.has(request.status)) {
                const { ending: _ending, ...kept } = row;
                await db.scheduleSubscriptions.put(kept);
            }
        }
    }
}

/**
 * spec: plr-d10 lane L8b-3 (R6, D-76) - mark each plot-season's मुख्य row from the pull's `plotMainSchedules`. The key is FULL, so a row
 * of a plot-season the server names a DIFFERENT row for (or none) loses the mark. Server rows only (a pending switch carries the mark
 * of the row it replaces until the server's own row arrives). The phone never decides which is main (thin client).
 */
async function markMainSchedules(db: AgriLogDatabase, mains: readonly PlotMainScheduleDto[]): Promise<void> {
    const named = new Set(mains.map(m => m.subscriptionId));
    for (const row of await db.scheduleSubscriptions.toArray()) {
        if (row.pending === true) continue;
        const shouldBeMain = named.has(row.id);
        if (shouldBeMain && row.isMain !== true) await db.scheduleSubscriptions.put({ ...row, isMain: true });
        if (!shouldBeMain && row.isMain === true) {
            const { isMain: _isMain, ...rest } = row;
            await db.scheduleSubscriptions.put(rest);
        }
    }
}

/** Returns how many server rows were kept. Never throws into the pull: a failure keeps the old rows and the next pull retries. */
export async function reconcileScheduleSubscriptions(db: AgriLogDatabase, payload: SyncPullResponse): Promise<number> {
    try {
        const fromServer = (payload.scheduleSubscriptions ?? [])
            .map(rowFromDto)
            .filter((row): row is ScheduleSubscriptionRow => row !== null);

        let kept = 0;
        await db.transaction('rw', [db.scheduleSubscriptions, db.mutationQueue], async () => {
            if (fromServer.length > 0) {
                await db.scheduleSubscriptions.bulkPut(fromServer);
                kept = fromServer.length;
            }
            // lane L8b-3 - the server's pick of the मुख्य schedule; an absent key (an older server) leaves the marks as they are.
            const mains = (payload as SyncPullResponse & { plotMainSchedules?: PlotMainScheduleDto[] }).plotMainSchedules;
            if (Array.isArray(mains)) await markMainSchedules(db, mains.filter(m => typeof m?.subscriptionId === 'string'));
            await sweepPendingScheduleChoices(db);
        });
        return kept;
    } catch (error) {
        console.warn(JSON.stringify({
            component: 'scheduleSubscriptionsReconciler',
            action: 'schedule_choices_not_kept_this_pull',
            reason: error instanceof Error ? error.message : String(error),
        }));
        return 0;
    }
}
