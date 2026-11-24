// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10; approved spec decision 4) - which plot the Schedule tab opens on.
//
// "Last worked" is read ONLY from this phone's own logs: the plot named by the newest log , counting the first named plot
// that this phone still holds. With no such log it is the first plot in the canonical order (the crops as the phone lists them, the plots as each crop lists them).
// Nothing here reads the server, so it works with no signal (P10).
import type { CropProfile, DailyLog } from '../../../types';

export interface PlotPick { cropId: string; plotId: string }
export interface LastWorked extends PlotPick { how: 'log' | 'first' }

export function canonicalFirstPlot(crops: readonly CropProfile[]): PlotPick | null {
    const crop = crops.find(c => c.plots.length > 0);
    return crop ? { cropId: crop.id, plotId: crop.plots[0].id } : null;
}

export function lastWorkedPlot(crops: readonly CropProfile[], logs: readonly DailyLog[]): LastWorked | null {
    const held = new Map<string, string>();
    for (const c of crops) for (const p of c.plots) held.set(p.id, c.id);
    // A log has a day, not a clock time: on the same day the one the phone holds LATER (written later) counts as newer.
    const newestFirst = logs.map((log, i) => ({ log, i })).sort((a, b) => (b.log.date ?? '').localeCompare(a.log.date ?? '') || b.i - a.i).map(x => x.log);
    for (const log of newestFirst) {
        for (const sel of log.context?.selection ?? []) {
            for (const plotId of sel.selectedPlotIds ?? []) {
                const cropId = held.get(plotId);
                if (cropId) return { cropId, plotId, how: 'log' };
            }
        }
    }
    const first = canonicalFirstPlot(crops);
    return first ? { ...first, how: 'first' } : null;
}
