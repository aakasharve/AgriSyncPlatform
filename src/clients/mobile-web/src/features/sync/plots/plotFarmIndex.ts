/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-2 (founder 27 Nov) - which farm each plot on this phone belongs to, for the open-farm read layer
 * (`app/helpers/openFarmView.ts`). The crop list (`crops`) is ONE list for the signed-in person, joined by crop name across every
 * farm he can see, and a plot in it carries no farm; the phone holds the farm elsewhere, so it is read from there (no new store,
 * the database version is unchanged):
 *   1. the downloaded plots table (`plots.farmId`, the server's own word);
 *   2. else the plot's `create_plot` in the queue (any state: a refused one still names the farm it was made on);
 *   3. else this phone's own record of a plot it made (`pendingPlots.ts`, written just before that queue row).
 * A plot none of them names has no known farm; the read layer never shows it on a farm it may not belong to. The plot's own mark
 * (`Plot.farmId`, written when a plot is added on this phone from now on) is read by the read layer after these.
 *
 * Also read here, for the same layer: every farm this phone holds anything of (downloaded farms, plots and queued plots), and each
 * downloaded farm's registrant (`ownerUserId`), whose name belongs to that farm's people.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { readPendingPlotRegistrations } from './pendingPlots';

export interface PlotFarmIndex {
    /** Plot id -> farm id, the best source first (see the file header). */
    plotFarm: ReadonlyMap<string, string>;
    /** Every farm this phone holds a downloaded farm, a downloaded plot or a queued plot of. */
    farmIds: ReadonlySet<string>;
    /** Downloaded farm id -> its registrant's user id. */
    farmOwner: ReadonlyMap<string, string>;
}

/** Nothing read yet. */
export const NO_PLOT_FARMS: PlotFarmIndex = { plotFarm: new Map(), farmIds: new Set(), farmOwner: new Map() };

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/**
 * Read the index from this phone's store. `null` when the store cannot be read (the caller keeps what it had: an index that
 * failed to read is not an index that names no plot, and reading it as one would hide every plot of a two-farm phone).
 */
export async function readPlotFarmIndex(): Promise<PlotFarmIndex | null> {
    try {
        const db = getDatabase();
        const plotFarm = new Map<string, string>();
        const farmIds = new Set<string>();
        const farmOwner = new Map<string, string>();
        const note = (plotId: unknown, farmId: unknown) => {
            const p = text(plotId);
            const f = text(farmId);
            if (!p || !f) return;
            if (!plotFarm.has(p)) plotFarm.set(p, f);
            farmIds.add(f);
        };

        for (const farm of await db.farms.toArray()) {
            farmIds.add(farm.id);
            const owner = text((farm.payload as { ownerUserId?: unknown } | null)?.ownerUserId);
            if (owner) farmOwner.set(farm.id, owner);
        }
        for (const row of await db.plots.toArray()) note(row.id, row.farmId);
        const queued = await db.mutationQueue.where('mutationType').equals(SyncMutationName.CreatePlot).toArray();
        for (const row of queued) {
            const payload = row.payload as { plotId?: unknown; farmId?: unknown } | null;
            note(payload?.plotId, payload?.farmId);
        }
        for (const reg of await readPendingPlotRegistrations()) note(reg.plotId, reg.farmId);
        return { plotFarm, farmIds, farmOwner };
    } catch (err) {
        console.error('[plotFarmIndex] the plots\' farms could not be read; the last read stays', err);
        return null;
    }
}
