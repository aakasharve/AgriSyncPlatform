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
import { moneyEntryIdFor } from '../../../finance/moneyEntryIdentity';
import { resolveMoneyPlace } from '../../../finance/moneyPlace';

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

/** The plots the entry is on now (empty = no plot: the whole farm, or a crop-level entry). */
const plotsOf = (log: DailyLog): string[] => (log.context?.selection ?? []).flatMap(s => s.selectedPlotIds ?? []);

/**
 * Lane OF-S fix 1 (B006) — is this the place the entry ALREADY has? The same plot(s), or the whole farm for an entry
 * that names no plot. Then nothing moves: nothing is queued and no version is counted (the server writes nothing for a
 * move to where the record already is, so a counted version would make every later confirm look stale).
 */
export function isSamePlace(log: DailyLog, scope: LogScope): boolean {
    const now = [...plotsOf(log)].sort();
    const chosen = [...scope.selectedPlotIds].sort();
    if (chosen.length === 0) return now.length === 0 && scope.selectedCropIds.includes(FARM_GLOBAL);
    return now.length === chosen.length && now.every((id, i) => id === chosen[i]);
}

/**
 * Lane OF-S fix 1 (B002) — the ids of the money entries this phone made from the entry's lines, exactly as it made them
 * (`LogCommandService.captureMoneyEventsFromLog`, `moneyEntryIdFor`): a crew's stated total, an input, machinery or
 * expense line. A crew is listed under its engagement id (how the money is keyed now, and how the server finds it) and,
 * where it differs, under its own line id (how a phone keyed it before).
 */
export function moneyIdsOf(log: DailyLog): string[] {
    const ids = new Set<string>();
    for (const crew of log.labour ?? []) {
        if (crew.labourAssignmentId) ids.add(moneyEntryIdFor(`${log.id}:labour:${crew.labourAssignmentId}`));
        if (crew.id) ids.add(moneyEntryIdFor(`${log.id}:labour:${crew.id}`));
    }
    for (const line of log.inputs ?? []) if (line.id) ids.add(moneyEntryIdFor(`${log.id}:input:${line.id}`));
    for (const line of log.machinery ?? []) if (line.id) ids.add(moneyEntryIdFor(`${log.id}:machinery:${line.id}`));
    for (const line of log.activityExpenses ?? []) if (line.id) ids.add(moneyEntryIdFor(`${log.id}:activity-expense:${line.id}`));
    return [...ids];
}

/**
 * Lane OF-S fix 1 (B002) — the entry's money follows it on THIS phone too, so its money book agrees before the next
 * pull: each of its money entries the phone holds takes the new plot (none for several plots or the whole farm), that
 * plot's season on the new day, and the new day. The amount never changes (P7). The server does the same in the move
 * itself; a refused move brings the server's own money back with its version (`logsRebuildMarker.ts`).
 */
async function followMoneyOnPhone(log: DailyLog, plotIds: readonly string[] | undefined, dateKey: string | undefined): Promise<void> {
    const ids = moneyIdsOf(log);
    if (ids.length === 0) return;
    const db = getDatabase();
    const rows = (await db.costEntries.bulkGet(ids)).filter((row): row is NonNullable<typeof row> => !!row);
    if (rows.length === 0) return;
    const onePlot = plotIds && plotIds.length === 1 ? plotIds[0] : undefined;
    const followed = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
        const payload = { ...(row.payload as Record<string, unknown>) };
        const day = dateKey ?? (typeof payload.entryDate === 'string' ? payload.entryDate.slice(0, 10) : undefined);
        if (plotIds) {
            const place = onePlot && day ? await resolveMoneyPlace(row.farmId, onePlot, day) : undefined;
            payload.plotId = onePlot;
            payload.cropCycleId = place && place.sendable ? place.cropCycleId : undefined;
        }
        if (dateKey) payload.entryDate = dateKey;
        await db.costEntries.put({ ...row, payload, updatedAt: new Date().toISOString() });
        followed.set(row.id, payload);
    }
    // Loaded only when money actually followed: the money book's module reads the phone's tables as it loads.
    const { financeService } = await import('../../../finance/financeService');
    financeService._updateEvents(events => events.map(e => {
        const payload = followed.get(e.id);
        if (!payload) return e;
        return {
            ...e,
            ...(plotIds && { plotId: payload.plotId as string | undefined, cropId: payload.cropCycleId as string | undefined }),
            ...(dateKey && { dateTime: `${dateKey}T00:00:00Z` }),
        };
    }));
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
    // fix 1 (B006): the place it already has is not a move.
    const scope = move.scope && !isSamePlace(current, move.scope) ? move.scope : undefined;
    const context = scope ? contextForPlace(scope, deps.crops) : undefined;
    if (scope && !context) {
        throw new Error(`move of ${log.id}: a chosen plot is not on this phone`);
    }
    if (!dateKey && !context) return current;

    const baseVersion = current.contentVersion ?? 1;
    const plotIds = scope?.selectedPlotIds ?? [];
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
    // The move is queued and written; the money book on this phone following it is a convenience the next pull also
    // gives (the server moves the money in the move itself). A failure here never undoes the move — it is kept in the log.
    await followMoneyOnPhone(current, context ? plotIds : undefined, dateKey)
        .catch((error: unknown) => console.error(`move of ${log.id}: its money on this phone could not follow yet`, error));
    return saved;
}
