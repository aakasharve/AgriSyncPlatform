// spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3)
//
// A plot made on the phone (the setup hub's add-plot wizard) never reached the server: no
// code queued `create_plot` or `create_crop_cycle`, the wizard minted ids like `p_<uuid>`
// that fail the sync contract's GUID check, and a log on such a plot could never resolve
// the crop cycle it belongs to — so the farmer's work on his new plot stayed on the phone.
//
// This queues the plot, then its crop cycle — in that order, so the server has the plot
// before the cycle and the cycle before any log (the queue sends oldest first) — records
// the plot in the phone's own "made here, not yet confirmed" list (`pendingPlots.ts`), and
// asks the sync worker to run now. A log on the plot is then queued straight away against
// the plot's derived cycle (`logSyncMutationService` reads that list), whatever its date —
// while the plot's rows are live. If the server refuses the plot, logs already queued on it
// are refused naming the plot (`MutationDependency.resolvePlotDependency`), and new ones
// stay on the phone, reported as unsent.
//
// WHAT IT DELIBERATELY DOES NOT DO (review of the first version):
//   • It writes nothing into the phone's copies of the server's plots and cycles. Those
//     tables mean "the server has this"; a row written before the server answered would
//     outlive a refusal as a plot that exists nowhere.
//   • It never guesses an area: the server refuses a plot without one, so such a plot is
//     not queued and is reported as unsent (the wizard asks for the area).
//
// IDEMPOTENT BY CONSTRUCTION. The cycle id is derived from the plot id, and both commands
// key their queue rows on those ids, so registering the same plot again — the start-up
// retry below — collapses into the rows already queued instead of making a second cycle.
//
// Never throws into the screen (doctrine P9): a failure is logged and reported as unsent.

import { CreatePlotCommand } from '../../../application/usecases/sync/CreatePlotCommand';
import { CreateCropCycleCommand } from '../../../application/usecases/sync/CreateCropCycleCommand';
import { systemClock } from '../../../core/domain/services/Clock';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { saveScheduleChoice } from '../../scheduler/schedulePage/saveScheduleChoice';
import { noteUnqueueableLogs } from '../status/unqueueableLogs';
import type { Plot } from '../../../types';
import { areaInAcres } from './plotArea';
import {
    type PendingPlotRegistration,
    cropCycleIdForPlot,
    readPendingPlotRegistrations,
    writePendingPlotRegistrations,
} from './pendingPlots';

export { areaInAcres, cropCycleIdForPlot };
export { PENDING_PLOT_REGISTRATIONS_KEY } from './pendingPlots';
export type { PendingPlotRegistration } from './pendingPlots';

/**
 * The farmer did not state a crop stage when adding the plot, and the server requires one.
 * Sent as an explicit "not stated" rather than a guessed stage (doctrine P4). Mirrors the
 * server's `CropCycle.UnstatedStage`, which keeps it out of the AI prompt's stage hint.
 */
export const UNSTATED_STAGE = 'unstated';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toDateKey = (iso: string | undefined): string =>
    (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : systemClock.nowISO().slice(0, 10));

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Is an `adopt_schedule` for this plot already in the outbox, in ANY state (waiting, sent, refused, discarded)? */
async function adoptAlreadyQueuedFor(plotId: string): Promise<boolean> {
    const rows = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.AdoptSchedule).toArray();
    return rows.some((row) => (row.payload as { plotId?: unknown } | null)?.plotId === plotId);
}

/**
 * spec: plr-d10 lane WIZARD-F2 - the plot's schedule choice, queued AFTER its plot and crop cycle.
 *
 * ORDER, read from the code (not assumed): the outbox hands the worker its rows oldest first (`MutationQueue.getPending` sorts on the
 * queue id) and the server handles one batch in the order sent (`PushSyncBatchHandler`, one `foreach` over the mutations). The adopt
 * (`AdoptScheduleHandler`) needs the PLOT (`PlotNotFound`) and the crop cycle, which must be this plot's (`CropCycleNotFound`), so it
 * is queued after `create_plot` and `create_crop_cycle` and carries the cycle id they were queued under. The adopt is the ordinary one
 * (`saveScheduleChoice`, the schedule tab's own door): the phone's pending subscription row is written with it, so the schedule tab
 * shows the choice at once and a download cannot put a default over it.
 *
 * Idempotent: a second call (the start-up retry) finds the phone's own pending row, or an adopt of this plot already in the outbox
 * (a refused one the sweep has cleared must not be asked again at every start), and queues nothing. Never throws (saveScheduleChoice
 * does not either); a choice the server cannot be told about stays on the phone and is logged.
 */
async function queueScheduleChoice(reg: PendingPlotRegistration): Promise<void> {
    const choice = reg.schedule;
    if (!choice) return;
    if (await adoptAlreadyQueuedFor(reg.plotId)) return;
    const result = await saveScheduleChoice([{ plotId: reg.plotId, templateId: choice.templateId, referenceDate: choice.referenceDate }]);
    if (result.notSent.length > 0 || result.missing.length > 0) {
        console.error('[registerNewPlotOnServer] the new plot\'s schedule could not be queued for the server', reg.plotId);
    }
}

async function enqueueRegistration(reg: PendingPlotRegistration): Promise<void> {
    const cropCycleId = await cropCycleIdForPlot(reg.plotId);
    await CreatePlotCommand.enqueue({ plotId: reg.plotId, farmId: reg.farmId, name: reg.name, areaInAcres: reg.areaInAcres });
    await CreateCropCycleCommand.enqueue({
        cropCycleId, farmId: reg.farmId, plotId: reg.plotId, cropName: reg.cropName, stage: UNSTATED_STAGE, startDate: reg.startDate,
    });
    await queueScheduleChoice(reg);
}

export type RegisterPlotOutcome = 'queued' | 'no-farm' | 'needs-area' | 'not-a-server-id' | 'failed';

export async function registerNewPlotOnServer(args: {
    plot: Plot;
    cropName: string;
    farmId?: string | null;
    /**
     * spec: plr-d10 lane WIZARD-F2 - the schedule a new plot follows by itself and the day it counts from (YYYY-MM-DD). Only a real server
     * schedule (a GUID id) and a real day are sent: the app's stand-in and a half-typed date never leave the phone.
     */
    schedule?: { templateId: string; referenceDate: string } | null;
}): Promise<RegisterPlotOutcome> {
    const { plot, cropName } = args;
    if (!GUID_RE.test(plot.id)) return 'not-a-server-id';

    const acres = areaInAcres(plot.baseline?.totalArea, plot.baseline?.unit);
    if (acres <= 0) {
        console.error('[registerNewPlotOnServer] plot has no area; kept on this phone only', plot.id);
        noteUnqueueableLogs([plot.id]);
        return 'needs-area';
    }

    const farmId = args.farmId ?? SessionStore.getCurrentFarmId();
    if (!farmId) {
        console.error('[registerNewPlotOnServer] no current farm on this phone; plot kept here only', plot.id);
        noteUnqueueableLogs([plot.id]);
        return 'no-farm';
    }

    const reg: PendingPlotRegistration = {
        plotId: plot.id, farmId, name: plot.name, areaInAcres: acres, cropName, startDate: toDateKey(plot.startDate),
        ...(args.schedule && GUID_RE.test(args.schedule.templateId) && DAY_KEY_RE.test(args.schedule.referenceDate)
            ? { schedule: { templateId: args.schedule.templateId, referenceDate: args.schedule.referenceDate } }
            : {}),
    };
    try {
        // The record goes first, the rows second, on purpose: if the app stops in between,
        // the start-up retry still finds the plot and queues its rows. A log cannot slip in
        // ahead of them meanwhile — the log path only uses a recorded plot once both rows
        // are in the queue and live (`findSendablePendingPlot`).
        const pending = await readPendingPlotRegistrations();
        await writePendingPlotRegistrations([...pending.filter((p) => p.plotId !== reg.plotId), reg]);
        await enqueueRegistration(reg);
        backgroundSyncWorker.triggerNow().catch((err: unknown) => {
            console.error('[registerNewPlotOnServer] sync run after queueing the plot failed', err);
        });
        return 'queued';
    } catch (err) {
        console.error('[registerNewPlotOnServer] the new plot could not be queued', plot.id, err);
        noteUnqueueableLogs([plot.id]);
        return 'failed';
    }
}

/**
 * Start-up retry. Every recorded phone-made plot the server has not sent back yet (it is
 * not in the phone's copy of the server's plots) is queued again, on the farm it was made
 * on; one the server has sent back is dropped from the list. A plot already queued — or
 * already refused — keeps its one queue row: the ids are the same, so the second enqueue
 * collapses into it. Never throws.
 */
export async function reconcileUnregisteredPlots(): Promise<number> {
    let attempted = 0;
    try {
        const db = getDatabase();
        const keep: PendingPlotRegistration[] = [];
        for (const reg of await readPendingPlotRegistrations()) {
            if (await db.plots.get(reg.plotId)) continue;
            keep.push(reg);
            attempted += 1;
            await enqueueRegistration(reg);
        }
        await writePendingPlotRegistrations(keep);
    } catch (err) {
        console.error('[reconcileUnregisteredPlots] start-up plot retry failed', err);
    }
    return attempted;
}
