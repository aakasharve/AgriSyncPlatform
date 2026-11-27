/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-2 (founder 27 Nov, "yes it matters") - the ONE read layer of the open farm. Pure: no React, no Dexie (the index it
 * reads is `features/sync/plots/plotFarmIndex.ts`), same pattern as the other `appContent*` helpers beside it.
 *
 * WHY. The phone keeps one crop list and one record list for the signed-in person, from every farm he can see; the download joins
 * plots into crops BY CROP NAME across farms (`profileAndCropsReconciler`). A person who is मुकादम on farm A and owner of farm B saw
 * both mixed on every screen: A's crop and plots on B, B's hub counting A's plots. The app shows ONE farm at a time - the one in the
 * header (FarmContext, the one source since FIX-1) - so every screen gets the lists through here, from `useAppData`:
 *   - a plot is on the open farm when its farm is the open farm (`farmOfPlot`); a plot of NO known farm is shown only to a person
 *     on one farm (it can belong nowhere else), never on a farm it may not belong to;
 *   - a crop is on the open farm when one of its plots is, or it was made on this phone on that farm (`CropProfile.farmId`); an old
 *     crop with no plots and no farm is shown only to a person on one farm;
 *   - a record is on the open farm when its own farm (`meta.farmId`) is, else when its plot's farm is; one of no known farm is
 *     shown only to a person on one farm;
 *   - the people: on one farm, exactly the list as it is; on two or more, himself, the farm's registrant and the people behind
 *     the farm's records (the server names exactly the people behind the rows it sends - `CollectOperatorIds` - with no farm
 *     on them, so their farm is read from those rows).
 * A view never changes the stored list; nothing is copied when nothing is filtered (a one-farm person gets the very same arrays).
 * With no open farm known yet, the lists go as they are (today).
 */
import type { CropProfile, DailyLog, FarmOperator, Plot } from '../../types';
import type { PlotFarmIndex } from '../../features/sync/plots/plotFarmIndex';

export interface OpenFarm {
    /** The farm in the header; `null` = none known yet (no filtering). */
    farmId: string | null;
    /** No farm other than the open one is known on this phone: what has no known farm can only be this one's. */
    oneFarm: boolean;
}

/**
 * The open farm, and whether it is the only farm this phone knows him on: the farms the phone holds anything of, and the farms
 * the server lists his seats on (`seatFarmIds`, from `/me/context`) - a second seat with nothing downloaded yet still counts.
 */
export function openFarmOf(farmId: string | null | undefined, index: PlotFarmIndex, seatFarmIds: readonly string[] = []): OpenFarm {
    const open = farmId || null;
    const others = [...index.farmIds, ...seatFarmIds].some(id => !!id && id !== open);
    return { farmId: open, oneFarm: !others };
}

/** The plot's farm: the downloaded table, then its queued `create_plot` / the phone's record (the index), then its own mark. */
export function farmOfPlot(plot: Pick<Plot, 'id' | 'farmId'>, index: PlotFarmIndex): string | null {
    return index.plotFarm.get(plot.id) ?? plot.farmId ?? null;
}

const onFarm = (farm: string | null, open: OpenFarm): boolean => (farm ? farm === open.farmId : open.oneFarm);

/** The open farm's crops, each with only the open farm's plots (the stored crop is never changed). */
export function cropsOnFarm(crops: CropProfile[], open: OpenFarm, index: PlotFarmIndex): CropProfile[] {
    if (!open.farmId) return crops;
    let changed = false;
    const out: CropProfile[] = [];
    for (const crop of crops) {
        const plots = crop.plots.filter(plot => onFarm(farmOfPlot(plot, index), open));
        const shown = plots.length > 0
            || (crop.farmId ? crop.farmId === open.farmId : crop.plots.length === 0 && open.oneFarm);
        if (!shown) { changed = true; continue; }
        if (plots.length === crop.plots.length) { out.push(crop); continue; }
        changed = true;
        out.push({ ...crop, plots });
    }
    return changed ? out : crops;
}

/** The record's farm: its own (`meta.farmId`, then its selection's), else its first plot of a known farm; `null` = not known. */
export function farmOfLog(log: DailyLog, index: PlotFarmIndex): string | null {
    if (log.meta?.farmId) return log.meta.farmId;
    const selection = log.context?.selection ?? [];
    const stated = selection.find(s => s.farmId)?.farmId;
    if (stated) return stated;
    for (const s of selection) {
        for (const plotId of s.selectedPlotIds ?? []) {
            const farm = index.plotFarm.get(plotId);
            if (farm) return farm;
        }
    }
    return null;
}

/** The open farm's records. */
export function logsOnFarm(logs: DailyLog[], open: OpenFarm, index: PlotFarmIndex): DailyLog[] {
    if (!open.farmId) return logs;
    const kept = logs.filter(log => onFarm(farmOfLog(log, index), open));
    return kept.length === logs.length ? logs : kept;
}

/**
 * The open farm's people from the people this phone knows (see the header). Never adds a person; on one farm the list as it is.
 * `selfIds` = who "you" are on this phone (the active operator, the signed-in user): always kept. A person added on this phone
 * (`localOnly`) is kept too: he was added on the farm open then, and is not stored past the session.
 */
export function peopleOnFarm(
    operators: FarmOperator[],
    open: OpenFarm,
    logs: readonly DailyLog[],
    index: PlotFarmIndex,
    selfIds: ReadonlySet<string>,
): FarmOperator[] {
    if (!open.farmId || open.oneFarm) return operators;
    const ofFarm = new Set<string>(selfIds);
    const owner = index.farmOwner.get(open.farmId);
    if (owner) ofFarm.add(owner);
    for (const log of logs) {
        if (farmOfLog(log, index) !== open.farmId) continue;
        if (log.meta?.createdByOperatorId) ofFarm.add(log.meta.createdByOperatorId);
        if (log.verification?.verifiedByOperatorId) ofFarm.add(log.verification.verifiedByOperatorId);
    }
    const kept = operators.filter(o => ofFarm.has(o.id) || o.localOnly === true);
    return kept.length === operators.length ? operators : kept;
}
