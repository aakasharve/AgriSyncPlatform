// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 6; founder-approved 2026-11-21) - `useFarmPlots` says each plot's
 * CROP. The stored plot row is the server's plot (id, farm, name, area) and holds no crop; the crop is read from the phone's crop list
 * (`CropProfile.plots`) and joined by plot id. A plot no crop holds has no crop (never guessed). Over a real fake-indexeddb Dexie.
 */
import 'fake-indexeddb/auto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { buildFarmPlots, cropOfPlotId, useFarmPlots } from '../useFarmPlots';

const FARM = 'farm-1';
const plotRow = (id: string, name: string, farmId = FARM) => ({ id, farmId, payload: { id, farmId, name, areaInAcres: 1 }, updatedAt: '2026-11-02T00:00:00Z' });
const cropBlob = (id: string, name: string, plotIds: string[], extra: Record<string, unknown> = {}) => ({
    id, name, iconName: 'Sprout', color: 'bg-green-500', plots: plotIds.map(p => ({ id: p, name: p })), supportedTasks: [], workflow: [], ...extra,
});
const putCrops = async (...crops: ReturnType<typeof cropBlob>[]) => {
    const db = getDatabase();
    await db.crops.clear();
    for (const c of crops) await db.crops.put({ id: c.id, data: c, updatedAtMs: 1 });
};

beforeEach(async () => {
    const db = getDatabase();
    await db.plots.clear();
    await db.crops.clear();
});
afterEach(cleanup);

describe('cropOfPlotId / buildFarmPlots (pure)', () => {
    it('joins each plot with the crop of the list that holds it, and keeps only what the shared card needs', () => {
        const map = cropOfPlotId([
            cropBlob('c1', 'Grapes', ['g1', 'g2'], { masterId: 'MHCR-0001', color: 'bg-green-500' }),
            cropBlob('c2', 'Sugarcane', ['u1'], { color: 'bg-pink-500' }),
        ]);
        expect(map.get('g2')?.crop).toEqual({ id: 'c1', name: 'Grapes', iconName: 'Sprout', masterId: 'MHCR-0001', color: 'bg-green-500' });
        expect(map.get('u1')?.crop).toEqual({ id: 'c2', name: 'Sugarcane', iconName: 'Sprout', color: 'bg-pink-500' });
        expect(map.get('nope')).toBeUndefined();
    });

    it('ignores a malformed crop row and takes the first crop that holds a plot', () => {
        const map = cropOfPlotId([null, { id: 'c0' }, { id: 'c1', name: 'A', plots: 'x' }, cropBlob('c2', 'First', ['p']), cropBlob('c3', 'Second', ['p'])]);
        expect(map.get('p')?.crop.id).toBe('c2');
    });

    it('lists crop by crop in the crop list\'s order, plots with no crop last, and inside a crop in natural order (G2 before G10)', () => {
        const rows = [plotRow('g10', 'G10'), plotRow('x', 'पडीक'), plotRow('u1', 'U1'), plotRow('g2', 'G2'), plotRow('g1', 'G1')];
        const plots = buildFarmPlots(rows, [cropBlob('cA', 'Sugarcane', ['u1']), cropBlob('cB', 'Grapes', ['g1', 'g2', 'g10'])]);
        expect(plots.map(p => p.id)).toEqual(['u1', 'g1', 'g2', 'g10', 'x']);
        expect(plots[0].crop?.id).toBe('cA');
        expect(plots[4].crop).toBeUndefined();
        expect('crop' in plots[4]).toBe(false);
    });

    it('keeps the old plain name order for names with no number, and an unnamed plot has an empty name', () => {
        const plots = buildFarmPlots([plotRow('b', 'प्लॉट दोन'), plotRow('a', 'प्लॉट एक'), plotRow('z', '  ')], []);
        expect(plots.map(p => p.name)).toEqual(['', 'प्लॉट एक', 'प्लॉट दोन']);
    });
});

describe('useFarmPlots (over Dexie)', () => {
    it('returns the farm\'s plots only, each with its crop from the crop list', async () => {
        const db = getDatabase();
        await db.plots.bulkPut([plotRow('g1', 'G1'), plotRow('g2', 'G2'), plotRow('u1', 'U1'), plotRow('other', 'दुसऱ्या शेताचा', 'farm-2')]);
        await putCrops(cropBlob('c1', 'Grapes', ['g1', 'g2'], { masterId: 'MHCR-0001' }), cropBlob('c2', 'Sugarcane', ['u1', 'other']));
        const { result } = renderHook(() => useFarmPlots(FARM));
        await waitFor(() => expect(result.current).toHaveLength(3));
        expect(result.current.map(p => [p.id, p.crop?.id])).toEqual([['g1', 'c1'], ['g2', 'c1'], ['u1', 'c2']]);
        expect(result.current[0].crop).toMatchObject({ name: 'Grapes', iconName: 'Sprout', masterId: 'MHCR-0001', color: 'bg-green-500' });
    });

    it('a plot no crop holds comes back with no crop (and the plots are still listed when there is no crop list at all)', async () => {
        const db = getDatabase();
        await db.plots.bulkPut([plotRow('p1', 'प्लॉट एक'), plotRow('p2', 'प्लॉट दोन')]);
        const { result } = renderHook(() => useFarmPlots(FARM));
        await waitFor(() => expect(result.current).toHaveLength(2));
        expect(result.current.every(p => p.crop === undefined)).toBe(true);
        expect(result.current.map(p => p.id)).toEqual(['p1', 'p2']);
    });

    it('follows the crop list live: a crop saved after the first read is picked up', async () => {
        const db = getDatabase();
        await db.plots.bulkPut([plotRow('g1', 'G1')]);
        const { result } = renderHook(() => useFarmPlots(FARM));
        await waitFor(() => expect(result.current).toHaveLength(1));
        expect(result.current[0].crop).toBeUndefined();
        await act(async () => { await putCrops(cropBlob('c1', 'Grapes', ['g1'])); });
        await waitFor(() => expect(result.current[0].crop?.id).toBe('c1'));
    });

    it('is empty with no farm', async () => {
        const { result } = renderHook(() => useFarmPlots(null));
        expect(result.current).toEqual([]);
    });
});
