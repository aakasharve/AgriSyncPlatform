// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useDayUnderstanding — unit tests (dfes-companion-2026-07-11 Slice 3b).
 * Mirrors useFarmerEngagement.test.tsx. Proves the hook fetches the server /10
 * for farmId + date when understandingMeter is ON, makes ZERO network calls when
 * the flag is OFF, and — crucially — yields `score: null` (never a client /100
 * fallback) on both a null server score and a failed/offline fetch.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const getDayUnderstanding = vi.fn();

async function loadHook(understandingMeter: boolean) {
    vi.resetModules();
    vi.doMock('../../../../infrastructure/api/AgriSyncClient', () => ({
        agriSyncClient: { getDayUnderstanding },
    }));
    vi.doMock('../../../../app/featureFlags', () => ({
        FEATURE_FLAGS: {
            understandingMeter,
            disciplineSystem: false,
            DwcChip: false,
        },
    }));
    const mod = await import('../useDayUnderstanding');
    return mod.useDayUnderstanding;
}

afterEach(() => {
    getDayUnderstanding.mockReset();
    vi.doUnmock('../../../../infrastructure/api/AgriSyncClient');
    vi.doUnmock('../../../../app/featureFlags');
    vi.resetModules();
});

describe('useDayUnderstanding', () => {
    it('loads the /10 score for farmId + date when understandingMeter is ON', async () => {
        getDayUnderstanding.mockResolvedValue({ score: 7 });
        const useDayUnderstanding = await loadHook(true);
        const { result } = renderHook(() => useDayUnderstanding('farm-1', '2026-07-11'));

        await waitFor(() => expect(result.current.score).toBe(7));
        expect(getDayUnderstanding).toHaveBeenCalledWith('farm-1', '2026-07-11');
        expect(result.current.error).toBeNull();
    });

    it('makes ZERO network calls when understandingMeter is OFF', async () => {
        const useDayUnderstanding = await loadHook(false);
        const { result } = renderHook(() => useDayUnderstanding('farm-1', '2026-07-11'));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(getDayUnderstanding).not.toHaveBeenCalled();
        expect(result.current.score).toBeNull();
    });

    it('stays null and does not fetch when farmId is null', async () => {
        const useDayUnderstanding = await loadHook(true);
        const { result } = renderHook(() => useDayUnderstanding(null, '2026-07-11'));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.score).toBeNull();
        expect(getDayUnderstanding).not.toHaveBeenCalled();
    });

    it('yields score null (no number) when the server returns a null score', async () => {
        getDayUnderstanding.mockResolvedValue({ score: null });
        const useDayUnderstanding = await loadHook(true);
        const { result } = renderHook(() => useDayUnderstanding('farm-1', '2026-07-11'));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.score).toBeNull();
        expect(result.current.error).toBeNull();
    });

    it('on a failed/offline fetch yields score null (NOT a client fallback) + an error', async () => {
        getDayUnderstanding.mockRejectedValue(new Error('offline'));
        const useDayUnderstanding = await loadHook(true);
        const { result } = renderHook(() => useDayUnderstanding('farm-1', '2026-07-11'));

        await waitFor(() => expect(result.current.error).toBe('offline'));
        expect(result.current.score).toBeNull();
    });
});
