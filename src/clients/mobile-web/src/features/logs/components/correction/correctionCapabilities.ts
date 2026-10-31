/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF → lane OF-S) — the two things the बदला screen could not do
 * until the SERVER had a route for them, each behind ONE switch. Lane OF-S added both routes and turned both on:
 *
 *   1. MOVE A SAVED ENTRY to another plot or another day ("प्लॉट बदला" / "दिवस बदला", founder D-61 = 5A + TAP-1):
 *      `move_daily_log`, queued like every other change, so it works with no internet and every phone's pull carries the
 *      new place and day (P10). The server refuses a stale move, a future day, a plot with no season that day and a move
 *      that would leave हजेरी or money behind; the phone then puts the entry back to the server's version and says why.
 *   2. A WORKER-COUNT change with no internet: `correct_labour_assignment`, queued instead of POSTed (`UpdateLog` step 4),
 *      through the same server handler as the online route.
 *
 * Turning a switch off again puts the screen back to its honest "not yet" state (P5); nothing else reads them.
 */
import type { CropProfile, DailyLog, FarmContext, FarmerProfile, LogScope, SelectedCropContext } from '../../../../types';
import type { UpdateLogResponse } from '../../../../application/usecases/UpdateLog';
import { MoveDailyLogCommand } from '../../../../application/usecases/sync/MoveDailyLogCommand';
import { assertNotAfterFarmToday } from '../../../../core/domain/services/farmDay';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';

const SWITCHES = {
    /** OF-S: a queued, offline-safe "move a saved log's plot / date" mutation exists (`move_daily_log`). */
    moveSavedEntry: true,
    /** OF-S: a labour-count correction is queued (sent later) instead of POSTed now (`correct_labour_assignment`). */
    queueLabourCountOffline: true,
} as const;

const FARM_GLOBAL = 'FARM_GLOBAL';

/** Recorded with the move (the phone's audit row; the server ledger keeps it as his reason) — never shown to him. */
export const MOVE_REASON = 'Moved by tap';

/** Can this phone move a SAVED entry to another plot / day? */
export const canMoveSavedEntry = (): boolean => SWITCHES.moveSavedEntry;

/** Can a worker-count change be made with no internet (queued)? */
export const canQueueLabourCountOffline = (): boolean => SWITCHES.queueLabourCountOffline;

/** Where he chose to move a saved entry (either part may be absent: only the plot, or only the day). */
export interface SavedEntryMove { scope?: LogScope; dateKey?: string }

/** What the move writes through: the ONE edit path (`LogCommandService.updateLog`) and the screen's history. */
export interface SavedEntryMoveDeps {
    crops: readonly CropProfile[];
    updateLog: (logId: string, updates: Partial<DailyLog>, profile: FarmerProfile, reason: string) => Promise<UpdateLogResponse>;
    setHistory: (update: (prev: DailyLog[]) => DailyLog[]) => void;
    profile: FarmerProfile;
}

/**
 * The entry's place as the record names it, from the crop → plot selector's choice: the plots grouped under their crops
 * (the same shape a new entry and the pull build), or the whole farm. `null` when a chosen plot is not on this phone —
 * the move is then refused here rather than written with a place the phone cannot name.
 */
export function contextForPlace(scope: LogScope, crops: readonly CropProfile[]): FarmContext | null {
    if (scope.selectedPlotIds.length === 0) {
        return scope.selectedCropIds.includes(FARM_GLOBAL)
            ? { selection: [{ cropId: FARM_GLOBAL, cropName: 'Farm', selectedPlotIds: [], selectedPlotNames: [] }] }
            : null;
    }
    const selection: SelectedCropContext[] = [];
    for (const plotId of scope.selectedPlotIds) {
        const crop = crops.find(c => c.plots.some(p => p.id === plotId));
        const plot = crop?.plots.find(p => p.id === plotId);
        if (!crop || !plot) return null;
        const entry = selection.find(s => s.cropId === crop.id);
        if (entry) {
            entry.selectedPlotIds.push(plot.id);
            entry.selectedPlotNames.push(plot.name);
        } else {
            selection.push({ cropId: crop.id, cropName: crop.name, selectedPlotIds: [plot.id], selectedPlotNames: [plot.name] });
        }
    }
    return { selection };
}

/** The entry as this phone holds it NOW (a change saved a moment ago may have moved its version on). */
async function currentOf(log: DailyLog): Promise<DailyLog> {
    const row = await getDatabase().logs.get(log.id);
    return row?.log ?? log;
}

/**
 * Lane OF-S — queue the move of a SAVED entry and write it on this phone. The move is queued FIRST, so its queue row
 * already guards the entry from a pull that lands in between (`readPendingLogIds`); then the moved place / day is written
 * through the ONE edit path with its audit row, one record version on (the server moves it one version too). A day after
 * the farm's today is refused before anything is written (`farmDay`). Returns the entry as it now stands; throws when
 * nothing could be written (the caller says so — never a silent no-op).
 */
export async function queueSavedEntryMove(log: DailyLog, move: SavedEntryMove, deps: SavedEntryMoveDeps): Promise<DailyLog> {
    const current = await currentOf(log);
    const dateKey = move.dateKey && move.dateKey !== current.date ? move.dateKey : undefined;
    if (dateKey) assertNotAfterFarmToday(dateKey);
    const context = move.scope ? contextForPlace(move.scope, deps.crops) : undefined;
    if (move.scope && !context) {
        throw new Error(`move of ${log.id}: a chosen plot is not on this phone`);
    }
    if (!dateKey && !context) return current;

    const baseVersion = current.contentVersion ?? 1;
    const plotIds = move.scope?.selectedPlotIds ?? [];
    await MoveDailyLogCommand.enqueue({
        dailyLogId: log.id,
        baseVersion,
        ...(context && (plotIds.length > 0 ? { newPlotIds: [...plotIds] } : { wholeFarm: true as const })),
        ...(dateKey && { newLogDate: dateKey }),
        reason: MOVE_REASON,
        revisedAtUtc: new Date().toISOString(),
    });

    const result = await deps.updateLog(log.id, {
        ...(context && { context }),
        ...(dateKey && { date: dateKey }),
        contentVersion: baseVersion + 1,
    }, deps.profile, MOVE_REASON);
    if (!result.success || !result.log) {
        throw new Error(`move of ${log.id} was queued but not written on this phone: ${result.error ?? 'unknown'}`);
    }
    const saved = result.log;
    deps.setHistory(prev => [saved, ...prev.filter(l => l.id !== log.id)]);
    return saved;
}
