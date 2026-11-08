// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 0b) - the plot's own understanding score, read from the server
 * (IT3). Offline, a failed read, a plot the server does not list, or a plot with no score gives NO number - never another plot's,
 * never the farm-day score, never a guess. No farm, no plot or the meter flag off makes no call at all.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getPlotDayUnderstanding = vi.fn();

async function loadHook(understandingMeter: boolean) {
    vi.resetModules();
    vi.doMock('../../../../infrastructure/api/AgriSyncClient', () => ({ agriSyncClient: { getPlotDayUnderstanding } }));
    vi.doMock('../../../../app/featureFlags', () => ({ FEATURE_FLAGS: { understandingMeter, disciplineSystem: false, DwcChip: false } }));
    return (await import('../usePlotDayUnderstanding')).usePlotDayUnderstanding;
}

afterEach(() => {
    getPlotDayUnderstanding.mockReset();
    vi.doUnmock('../../../../infrastructure/api/AgriSyncClient');
    vi.doUnmock('../../../../app/featureFlags');
    vi.resetModules();
});

const ROWS = [
    { plotId: 'plot-1', score0to10: 6, understood: [], nextHint: null },
    { plotId: 'plot-2', score0to10: null, understood: [], nextHint: null },
];

describe('usePlotDayUnderstanding', () => {
    it('gives the score of THIS plot for the farm and day', async () => {
        getPlotDayUnderstanding.mockResolvedValue(ROWS);
        const hook = await loadHook(true);
        const { result } = renderHook(() => hook('farm-1', 'plot-1', '2026-11-09'));
        await waitFor(() => expect(result.current.score).toBe(6));
        expect(getPlotDayUnderstanding).toHaveBeenCalledWith('farm-1', '2026-11-09');
    });

    it('a plot with no score, or one the server does not list, gives null - never another plot\'s', async () => {
        getPlotDayUnderstanding.mockResolvedValue(ROWS);
        const hook = await loadHook(true);
        const a = renderHook(() => hook('farm-1', 'plot-2', '2026-11-09'));
        await waitFor(() => expect(getPlotDayUnderstanding).toHaveBeenCalledTimes(1));
        expect(a.result.current.score).toBeNull();
        const b = renderHook(() => hook('farm-1', 'plot-9', '2026-11-09'));
        await waitFor(() => expect(getPlotDayUnderstanding).toHaveBeenCalledTimes(2));
        expect(b.result.current.score).toBeNull();
    });

    it('offline or failed: no number', async () => {
        getPlotDayUnderstanding.mockRejectedValue(new Error('offline'));
        const hook = await loadHook(true);
        const { result } = renderHook(() => hook('farm-1', 'plot-1', '2026-11-09'));
        await waitFor(() => expect(getPlotDayUnderstanding).toHaveBeenCalled());
        expect(result.current.score).toBeNull();
    });

    it('no plot, no farm, or the flag off: not a single call', async () => {
        const on = await loadHook(true);
        renderHook(() => on('farm-1', null, '2026-11-09'));
        renderHook(() => on(null, 'plot-1', '2026-11-09'));
        expect(getPlotDayUnderstanding).not.toHaveBeenCalled();
        const off = await loadHook(false);
        renderHook(() => off('farm-1', 'plot-1', '2026-11-09'));
        expect(getPlotDayUnderstanding).not.toHaveBeenCalled();
    });
});
