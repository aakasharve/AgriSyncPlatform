/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10; approved spec decision 4) - the tab opens on the plot last worked, read from the phone's own logs,
 * and falls back to the first plot in the canonical order (crops as the phone lists them, plots as each crop lists them).
 */
import { describe, expect, it } from 'vitest';
import { lastWorkedPlot, canonicalFirstPlot } from '../lastWorkedPlot';

const crops: any[] = [
    { id: 'c0', name: 'Empty', plots: [] },
    { id: 'c1', name: 'Grapes', plots: [{ id: 'p1', name: 'G1' }, { id: 'p2', name: 'G2' }] },
    { id: 'c2', name: 'Pomegranate', plots: [{ id: 'p3', name: 'D1' }] },
];
const log = (date: string, createdAtISO: string, plotIds: string[], cropId = 'c1'): any => ({ id: date + plotIds.join(), date, createdAtISO, context: { selection: [{ cropId, cropName: 'x', selectedPlotIds: plotIds, selectedPlotNames: [] }] } });

describe('the plot the tab opens on', () => {
    it('falls back to the first plot of the first crop that has one when nothing was logged', () => {
        expect(lastWorkedPlot(crops, [])).toEqual({ cropId: 'c1', plotId: 'p1', how: 'first' });
        expect(canonicalFirstPlot(crops)).toEqual({ cropId: 'c1', plotId: 'p1' });
    });
    it('opens on the plot of the newest log (by its day; on the same day the one held later)', () => {
        const logs = [log('2026-11-20', 'a', ['p1']), log('2026-11-22', '2026-11-22T08:00:00Z', ['p3'], 'c2'), log('2026-11-22', '2026-11-22T09:00:00Z', ['p2'])];
        expect(lastWorkedPlot(crops, logs)).toEqual({ cropId: 'c1', plotId: 'p2', how: 'log' });
    });
    it('a log that names several plots counts the first of them that this phone still holds', () => {
        expect(lastWorkedPlot(crops, [log('2026-11-22', 'a', ['gone', 'p3'], 'c2')])).toEqual({ cropId: 'c2', plotId: 'p3', how: 'log' });
    });
    it('ignores a log of a plot that is no longer there', () => {
        expect(lastWorkedPlot(crops, [log('2026-11-22', 'a', ['gone'])])).toEqual({ cropId: 'c1', plotId: 'p1', how: 'first' });
    });
    it('is null with no plot anywhere', () => {
        expect(lastWorkedPlot([{ id: 'c', name: 'x', plots: [] } as any], [])).toBeNull();
    });
});
