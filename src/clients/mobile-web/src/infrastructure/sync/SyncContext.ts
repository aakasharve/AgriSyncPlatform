import type { SyncPullResponse } from '../api/AgriSyncClient';
import { getDatabase } from '../storage/DexieDatabase';

const LAST_PULL_PAYLOAD_KEY = 'shramsafal_last_pull_payload';

type SyncPullSnapshot = Partial<SyncPullResponse> & {
    farms?: Array<{ id?: string }>;
    plots?: Array<{ id?: string; farmId?: string }>;
};

function readString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export async function resolveFarmIdFromSyncState(preferredPlotId?: string): Promise<string | null> {
    const db = getDatabase();
    const snapshotEntry = await db.appMeta.get(LAST_PULL_PAYLOAD_KEY);
    const snapshot = (snapshotEntry?.value ?? null) as SyncPullSnapshot | null;

    if (!snapshot) {
        return null;
    }

    const requestedPlotId = readString(preferredPlotId);
    if (requestedPlotId && Array.isArray(snapshot.plots)) {
        const plotMatch = snapshot.plots.find(plot => readString(plot?.id) === requestedPlotId);
        const plotFarmId = readString(plotMatch?.farmId);
        if (plotFarmId) {
            return plotFarmId;
        }
    }

    if (Array.isArray(snapshot.farms)) {
        for (const farm of snapshot.farms) {
            const farmId = readString(farm?.id);
            if (farmId) {
                return farmId;
            }
        }
    }

    return null;
}
