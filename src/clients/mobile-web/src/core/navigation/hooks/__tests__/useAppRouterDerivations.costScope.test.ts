// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (PLR-D9 T1, P4) — the log screen's
// cost card names what its money covers, and never shows the first selected plot's money
// as if it were the whole selection's.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { getTotalCost } = vi.hoisted(() => ({ getTotalCost: vi.fn() }));
vi.mock('../../../../features/finance/financeSelectors', () => ({
    financeSelectors: {
        getTotalCost,
        getBreakdown: () => ({ lines: [] }),
    },
}));

import { useAppRouterDerivations } from '../useAppRouterDerivations';

const crops = [
    { id: 'grapes', name: 'द्राक्षे', plots: [{ id: 'p1', name: 'विहिरीजवळ' }, { id: 'p2', name: 'ओढ्याकडे' }] },
    { id: 'cane', name: 'ऊस', plots: [{ id: 'p3', name: 'मळा' }] },
];

function render(selectedCropIds: string[], selectedPlotIds: string[]) {
    return renderHook(() => useAppRouterDerivations({
        farmerProfile: { name: 'Purvesh', operators: [] } as never,
        crops: crops as never,
        history: [],
        plannedTasks: [],
        selectedCropIds,
        selectedPlotIds,
    })).result.current;
}

/** The filters every total was asked for — they must all agree with the label. */
const filtersAsked = () => getTotalCost.mock.calls.map(([f]) => ({ cropId: f.cropId, plotId: f.plotId }));

describe('the cost card says what its money covers', () => {
    beforeEach(() => {
        getTotalCost.mockReset();
        getTotalCost.mockReturnValue(0);
    });

    it('one plot: that plot, by name', () => {
        const { costSnapshot } = render(['grapes'], ['p2']);
        expect(costSnapshot.scopeLabel).toBe('ओढ्याकडे');
        expect(new Set(filtersAsked().map(f => JSON.stringify(f)))).toEqual(new Set([JSON.stringify({ cropId: 'grapes', plotId: 'p2' })]));
    });

    it('two plots of one crop: the crop, by name — not the first plot passed off as both', () => {
        const { costSnapshot } = render(['grapes'], ['p1', 'p2']);
        expect(costSnapshot.scopeLabel).toBe('द्राक्षे');
        expect(filtersAsked().every(f => f.cropId === 'grapes' && f.plotId === undefined)).toBe(true);
    });

    it('plots of two crops: the whole farm, named as the farm', () => {
        const { costSnapshot } = render(['grapes', 'cane'], ['p1', 'p3']);
        expect(costSnapshot.scopeLabel).toBe('संपूर्ण शेत');
        expect(filtersAsked().every(f => f.cropId === undefined && f.plotId === undefined)).toBe(true);
    });

    it('nothing selected: the whole farm', () => {
        expect(render([], []).costSnapshot.scopeLabel).toBe('संपूर्ण शेत');
    });
});
