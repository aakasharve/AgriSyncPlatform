/**
 * spec: pre-launch-repair L2b (R-2; alignment N1) — WHERE a money entry goes, in the server's own ids.
 *
 * The phone used to send its own crop label as the crop-season id (`cropCycleId: event.cropId` — `crop_<name>`,
 * `c_<uuid>` or `''`). The contract needs a server crop-cycle GUID and the outbox checks that before queueing,
 * so every bill tagged to a plot or crop, and every voice expense on a log naming one crop, was dropped on the
 * phone and never reached the server. The rule now:
 *
 *   - no plot named → whole-farm entry: no plot, no crop season (a crop alone cannot name one season);
 *   - a plot the SERVER sent this phone (`db.plots`, same farm) → that plot, and the crop season whose own dates
 *     contain the entry's date (`selectCycleContainingDate`, the log recovery's rule) — none or two → omitted,
 *     never guessed;
 *   - a plot made on THIS phone that is queued and still sendable → that plot and its derived season, queued
 *     behind them (the log path's rule, `findSendablePendingPlot`), when the entry is on or after its start;
 *   - any other plot (a legacy `p_` plot, a plot of another farm, a plot this phone does not know) → NOT SENT:
 *     the entry stays on this phone, kept and listed in खरेदी as unsent — never quietly turned into a
 *     whole-farm entry, which would change what the farmer said.
 */
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import type { CropCycleDto } from '../../infrastructure/api/AgriSyncClient';
import { selectCycleContainingDate } from '../logs/services/logSyncMutationService';
import { cropCycleIdForPlot, findSendablePendingPlot } from '../sync/plots/pendingPlots';

export type MoneyPlace =
    | { sendable: true; plotId?: string; cropCycleId?: string }
    | { sendable: false; reason: 'plot-not-on-server' };

/** `dateKey` = the entry's own date (YYYY-MM-DD). */
export async function resolveMoneyPlace(farmId: string, plotId: string | undefined, dateKey: string): Promise<MoneyPlace> {
    if (!plotId) return { sendable: true };

    const db = getDatabase();
    const serverPlot = await db.plots.get(plotId).catch(() => undefined);
    if (serverPlot && serverPlot.farmId === farmId) {
        const cycles = await db.cropCycles.where('plotId').equals(plotId).toArray().catch(() => []);
        const cycle = selectCycleContainingDate(cycles.map(r => r.payload as CropCycleDto), dateKey);
        return { sendable: true, plotId, ...(cycle ? { cropCycleId: cycle.id } : {}) };
    }

    const pending = await findSendablePendingPlot(plotId).catch(() => null);
    if (pending && pending.farmId === farmId) {
        const startsBy = Date.parse(pending.startDate);
        const at = Date.parse(dateKey);
        const inSeason = !Number.isNaN(startsBy) && !Number.isNaN(at) && at >= startsBy;
        return { sendable: true, plotId, ...(inSeason ? { cropCycleId: await cropCycleIdForPlot(plotId) } : {}) };
    }

    return { sendable: false, reason: 'plot-not-on-server' };
}
