/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-2 (founder 27 Nov) - the save from one farm's screen. Pure.
 *
 * Every crop screen (the सेट-अप केंद्र's पिकं आणि प्लॉट, add crop, add plot, map a plot, the schedule page) hands back the list it was
 * SHOWN - the open farm's, from `openFarmView.cropsOnFarm` - with its edit in it. The old save wrote that list over the whole stored
 * list (`DexieCropsRepository.save` is replace-all), so a save on farm B would have deleted every plot of farm A. This merge:
 *   - keeps every stored crop and plot the screen was NOT shown (another farm's, one of no known farm, one a download added since);
 *   - takes the screen's version of what it was shown and still lists, in the screen's own order;
 *   - removes only what the screen was shown and no longer lists: removing a crop on farm B removes B's plots of it, and the crop
 *     stays for farm A's plots;
 *   - marks what is new with the open farm (`farmId`), so a new crop or plot shows on the farm it was made on from the first save.
 * When the screen was shown everything (a person on one farm), the result is exactly the screen's list, as before.
 */
import type { CropProfile, Plot } from '../../types';

interface Keyed { id: string }

/**
 * `stored` in its own order, each place of an item the screen still lists filled with the screen's items in the screen's order,
 * items the screen does not list passed to `orphan` (kept when it returns one), and the screen's new items appended.
 */
function slotMerge<T extends Keyed>(
    stored: readonly T[],
    next: readonly T[],
    pair: (stored: T, next: T) => T,
    orphan: (stored: T) => T | null,
    fresh: (next: T) => T,
): T[] {
    const storedById = new Map(stored.map(s => [s.id, s]));
    const inNext = new Set(next.map(n => n.id));
    const queue = next.filter(n => storedById.has(n.id));
    const out: T[] = [];
    let q = 0;
    for (const s of stored) {
        if (inNext.has(s.id)) {
            const n = queue[q++];
            out.push(pair(storedById.get(n.id) as T, n));
            continue;
        }
        const kept = orphan(s);
        if (kept) out.push(kept);
    }
    for (const n of next) if (!storedById.has(n.id)) out.push(fresh(n));
    return out;
}

/**
 * The stored list after a save from the open farm's screen.
 * @param stored the crop list as stored now (read in the same transaction as the write - `DexieCropsRepository.saveMerged`).
 * @param next   the list the screen hands back.
 * @param seen   the list the screen was shown (the read layer's latest view).
 * @param farmId the open farm (`null`: none known; nothing is marked).
 */
export function mergeFarmSave(stored: CropProfile[], next: CropProfile[], seen: readonly CropProfile[], farmId: string | null): CropProfile[] {
    const seenCropIds = new Set(seen.map(c => c.id));
    const seenPlotIds = new Set(seen.flatMap(c => c.plots.map(p => p.id)));
    const nextPlotIds = new Set(next.flatMap(c => c.plots.map(p => p.id)));
    const storedPlotIds = new Set(stored.flatMap(c => c.plots.map(p => p.id)));

    /** A stored plot the screen does not list: it stays unless the screen was shown it (then it was removed here). */
    const keptPlot = (p: Plot): Plot | null => (seenPlotIds.has(p.id) || nextPlotIds.has(p.id) ? null : p);
    const markPlot = (p: Plot): Plot => (farmId && !p.farmId && !storedPlotIds.has(p.id) ? { ...p, farmId } : p);

    return slotMerge<CropProfile>(
        stored,
        next,
        (s, n) => ({ ...n, plots: slotMerge<Plot>(s.plots, n.plots, (_sp, np) => np, keptPlot, markPlot) }),
        (s) => {
            if (!seenCropIds.has(s.id)) return s;
            // Removed on this farm: only the plots this farm's screen was never shown stay with it, and the crop no longer
            // claims the farm it was removed from.
            const plots = s.plots.filter(p => keptPlot(p) !== null);
            if (plots.length === 0) return null;
            const rest: CropProfile = { ...s, plots };
            if (farmId && rest.farmId === farmId) delete rest.farmId;
            return rest;
        },
        (n) => ({ ...n, ...(farmId && !n.farmId ? { farmId } : {}), plots: n.plots.map(markPlot) }),
    );
}
