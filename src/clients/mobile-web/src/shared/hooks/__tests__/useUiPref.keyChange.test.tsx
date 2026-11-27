// @vitest-environment jsdom
/**
 * Repair FIX-1 round 1 re-drive (Bug 1, the check-10 path) — a per-farm mark must not carry over to another farm.
 *
 * The Setup Hub reads "सध्या मी एकटाच शेती पाहतो" through `useUiPref(teamSoloKey(farmId))`. With the hub open, a farm switch
 * changes the KEY. When the new farm has no stored row, the hook kept the previous farm's value, so farm 2 showed farm 1's
 * solo mark: no first team card, and farm 1's "N पैकी N पूर्ण". A new key starts from the fallback ("don't know yet"), then
 * reads its own row.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = vi.hoisted(() => new Map<string, unknown>());
const gets = vi.hoisted(() => ({ hold: null as null | Promise<void> }));
vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        uiPrefs: {
            get: async (key: string) => {
                if (gets.hold) await gets.hold;
                return rows.has(key) ? { key, value: rows.get(key) } : undefined;
            },
            put: async (row: { key: string; value: unknown }) => { rows.set(row.key, row.value); },
        },
    }),
}));
vi.mock('../../../infrastructure/storage/activeDatabaseName', () => ({ onActiveDatabaseChanged: () => () => { /* none */ } }));

import { useUiPref } from '../useUiPref';

beforeEach(() => {
    rows.clear();
    gets.hold = null;
});

describe('useUiPref — a changed key never shows the previous key\'s value', () => {
    it('farm 1 marked solo, farm 2 not: switching to farm 2 reads false, and back reads true', async () => {
        rows.set('farm:teamSolo:F1', true);
        const { result, rerender } = renderHook(({ k }) => useUiPref<boolean>(k, false), { initialProps: { k: 'farm:teamSolo:F1' } });
        await waitFor(() => expect(result.current[2]).toBe(true));
        expect(result.current[0]).toBe(true);

        rerender({ k: 'farm:teamSolo:F2' });
        await waitFor(() => expect(result.current[2]).toBe(true));
        expect(result.current[0]).toBe(false);

        rerender({ k: 'farm:teamSolo:F1' });
        await waitFor(() => expect(result.current[2]).toBe(true));
        expect(result.current[0]).toBe(true);
    });

    it('while the new key is still being read, it says "not loaded" with the fallback, never the old value', async () => {
        rows.set('farm:teamSolo:F1', true);
        const { result, rerender } = renderHook(({ k }) => useUiPref<boolean>(k, false), { initialProps: { k: 'farm:teamSolo:F1' } });
        await waitFor(() => expect(result.current[2]).toBe(true));

        let release: () => void = () => {};
        gets.hold = new Promise<void>(r => { release = r; });
        rerender({ k: 'farm:teamSolo:F2' });
        expect(result.current[0]).toBe(false);
        expect(result.current[2]).toBe(false);

        await act(async () => { release(); });
        await waitFor(() => expect(result.current[2]).toBe(true));
        expect(result.current[0]).toBe(false);
    });

    it('a set on the new key writes the new key only', async () => {
        const { result, rerender } = renderHook(({ k }) => useUiPref<boolean>(k, false), { initialProps: { k: 'farm:teamSolo:F1' } });
        await waitFor(() => expect(result.current[2]).toBe(true));
        rerender({ k: 'farm:teamSolo:F2' });
        await waitFor(() => expect(result.current[2]).toBe(true));
        act(() => { result.current[1](true); });
        await waitFor(() => expect(rows.get('farm:teamSolo:F2')).toBe(true));
        expect(rows.has('farm:teamSolo:F1')).toBe(false);
        expect(result.current[0]).toBe(true);
    });
});
