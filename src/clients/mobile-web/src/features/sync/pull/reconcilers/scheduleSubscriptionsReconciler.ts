/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2, founder D-32, register F09) - the SERVER WINS on download.
 *
 * The pull carries `scheduleSubscriptions`: each plot's chosen schedule, every state, changed since this phone's cursor. They
 * are kept in Dexie `scheduleSubscriptions` (schema v27) and `resolvePlotSchedule` reads a plot's Active row first, so every
 * phone of the farm follows the same schedule and a download can never put the crop-type default over a choice.
 *
 * What this step does, in order:
 *   1. every row the server sent replaces the phone's copy of that subscription (by id; the phone's `pending` mark goes);
 *   2. then, for each plot, a choice made on THIS phone that is still unanswered (`pending`) is dropped when the server holds
 *      a DIFFERENT Active row for the plot AND the phone's own request is no longer waiting to be sent (it was refused and
 *      parked, or discarded): "दुसऱ्या फोनवरून वेगळं शेड्यूल निवडलं आहे" - the server's choice stands, never a silent
 *      overwrite either way. A request still waiting keeps the phone's choice visible until the server has answered it (P10).
 *      A plot with NO server row keeps its pending choice (a refusal, e.g. no authority, keeps it visible and parked).
 * Runs on every pull, also when the pull carries no rows, because a refusal can arrive after the row it lost to.
 * An older server sends no key: nothing is received, the sweep still runs, nothing is lost (P11).
 */
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../../infrastructure/sync/MutationQueue';
import type { ScheduleSubscriptionRow } from '../../../../infrastructure/storage/scheduleSubscriptionRow';
import { AdoptScheduleCommand, MigrateScheduleCommand } from '../../../../application/usecases/sync/ScheduleChoiceCommands';
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

/**
 * This phone's unanswered choices against what the server holds for the same plot (B001, B003, B008):
 *   - a request still waiting keeps its pending row (his intent is shown until the server answers, P10);
 *   - once it is not waiting, and the server holds a DIFFERENT Active row for the plot, the server's choice stands: the pending
 *     row goes (the parked request stays on the conflict page with its words);
 *   - a `ScheduleAlreadyAdopted` refusal whose server Active row is the SAME schedule is not a conflict: both phones agree, so
 *     the pending row goes AND the refusal is dropped from the conflict page - nothing is parked;
 *   - a plot with no server row keeps its pending row (a refusal, e.g. no authority, keeps his choice visible and parked).
 */
export async function sweepPendingScheduleChoices(db: AgriLogDatabase): Promise<void> {
    const deviceId = mutationQueue.getDeviceId();
    const all = await db.scheduleSubscriptions.toArray();
    const serverActive = new Map<string, ScheduleSubscriptionRow>();
    for (const row of all) {
        if (row.pending !== true && row.state === 'Active') serverActive.set(row.plotId, row);
    }
    for (const row of all) {
        if (row.pending !== true) continue;
        const server = serverActive.get(row.plotId);
        if (!server || server.id === row.id) continue;
        const request = await requestOf(db, deviceId, row.id);
        if (request && WAITING.has(request.status)) continue;
        if (request?.id !== undefined && request.status === 'REJECTED_USER_REVIEW'
            && codeTail(request.errorCode) === 'SCHEDULEALREADYADOPTED' && server.templateId === row.templateId) {
            await db.mutationQueue.update(request.id, { status: 'REJECTED_DROPPED' });
        }
        await db.scheduleSubscriptions.delete(row.id);
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
