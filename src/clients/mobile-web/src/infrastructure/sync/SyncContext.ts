import type { SyncPullResponse } from '../api/AgriSyncClient';
import { getDatabase } from '../storage/DexieDatabase';

const LAST_PULL_PAYLOAD_KEY = 'shramsafal_last_pull_payload';

type SyncPullSnapshot = Partial<SyncPullResponse> & {
    plots?: Array<{ id?: string; farmId?: string }>;
};

function readString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * The farm a PLOT belongs to, as the server last said — or `null`.
 *
 * spec: pre-launch-repair L2a (R-3, D-19). This used to answer with the FIRST farm of the last
 * download (and then the first farm in Dexie) whenever the plot gave no answer — or when no plot was
 * named at all — so a bill photo of a farmer with two farms could go to the wrong one. It now answers
 * only from the plot; with no plot, or a plot this phone does not know, it says it does not know and
 * the caller decides (the farm the app is working on, or asking the farmer) — never a guessed farm.
 */
export async function resolveFarmIdFromSyncState(preferredPlotId?: string): Promise<string | null> {
    const requestedPlotId = readString(preferredPlotId);
    if (!requestedPlotId) {
        return null;
    }

    const db = getDatabase();

    // Primary source: the most recent /sync/pull response snapshot.
    const snapshotEntry = await db.appMeta.get(LAST_PULL_PAYLOAD_KEY);
    const snapshot = (snapshotEntry?.value ?? null) as SyncPullSnapshot | null;
    if (snapshot && Array.isArray(snapshot.plots)) {
        const plotMatch = snapshot.plots.find(plot => readString(plot?.id) === requestedPlotId);
        const plotFarmId = readString(plotMatch?.farmId);
        if (plotFarmId) {
            return plotFarmId;
        }
    }

    // The snapshot may not yet be written (race between auth-redirect and the post-login pull), but the
    // reconciler also keeps the plots in Dexie.
    try {
        const plotRecord = await db.plots.get(requestedPlotId);
        return readString(plotRecord?.farmId);
    } catch {
        // Dexie schema may be mid-upgrade: not knowing is the honest answer.
        return null;
    }
}

/**
 * `farmId` — only if this phone holds that farm (the server sent it to this phone); else `null`.
 *
 * The ONE check for "is this a farm this phone knows": the log path's recorded farm
 * (`resolveRecordedFarmId` in `logSyncMutationService.ts`) and the bill sheet's remembered farm pointer
 * (spec: pre-launch-repair L2a, review m8) both go through it. Never "the only farm", never a sentinel.
 */
export async function resolveKnownFarmId(farmId: string | null | undefined): Promise<string | null> {
    if (!farmId) {
        return null;
    }

    const farmRecord = await getDatabase().farms.get(farmId);
    return farmRecord ? farmId : null;
}
