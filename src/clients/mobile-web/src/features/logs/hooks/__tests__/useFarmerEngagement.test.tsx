// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const getFarmerEngagement = vi.fn();

const dto = {
    currentStreak: 3,
    longestStreak: 5,
    totalShramPoints: 40,
    lastAccountedDate: '2026-07-11',
    totalRichDays: 12,
    unlockStatus: 'locked' as const,
};

async function loadHook(dfesEnabled: boolean) {
    vi.resetModules();
    vi.doMock('../../../../infrastructure/api/AgriSyncClient', () => ({
        agriSyncClient: { getFarmerEngagement },
    }));
    vi.doMock('../../../../app/featureFlags', () => ({
        FEATURE_FLAGS: {
            disciplineSystem: dfesEnabled,
            understandingMeter: false,
            DwcChip: false,
        },
    }));
    const mod = await import('../useFarmerEngagement');
    return mod.useFarmerEngagement;
}

afterEach(() => {
    getFarmerEngagement.mockReset();
    vi.doUnmock('../../../../infrastructure/api/AgriSyncClient');
    vi.doUnmock('../../../../app/featureFlags');
    vi.resetModules();
});

describe('useFarmerEngagement', () => {
    it('loads the engagement dto for a farmId when a DFES flag is ON', async () => {
        getFarmerEngagement.mockResolvedValue(dto);
        const useFarmerEngagement = await loadHook(true);
        const { result } = renderHook(() => useFarmerEngagement('farm-1'));

        await waitFor(() => expect(result.current.engagement).toEqual(dto));
        expect(getFarmerEngagement).toHaveBeenCalledWith('farm-1');
        expect(result.current.error).toBeNull();
    });

    it('makes ZERO network calls when both DFES flags are OFF', async () => {
        const useFarmerEngagement = await loadHook(false);
        const { result } = renderHook(() => useFarmerEngagement('farm-1'));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(getFarmerEngagement).not.toHaveBeenCalled();
        expect(result.current.engagement).toBeNull();
    });

    it('stays null and does not fetch when farmId is null', async () => {
        const useFarmerEngagement = await loadHook(true);
        const { result } = renderHook(() => useFarmerEngagement(null));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.engagement).toBeNull();
        expect(getFarmerEngagement).not.toHaveBeenCalled();
    });

    it('captures a friendly error message on failure', async () => {
        getFarmerEngagement.mockRejectedValue(new Error('boom'));
        const useFarmerEngagement = await loadHook(true);
        const { result } = renderHook(() => useFarmerEngagement('farm-1'));

        await waitFor(() => expect(result.current.error).toBe('boom'));
        expect(result.current.engagement).toBeNull();
    });
});
