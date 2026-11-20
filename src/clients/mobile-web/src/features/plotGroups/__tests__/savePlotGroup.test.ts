// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (lane GRP-1a) - savePlotGroup is online only and honest: the phone's copy
// of the plot holds the SERVER'S answer after a save, and is exactly as it was after every kind of "not saved".
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import type { PlotDto } from '../../../infrastructure/api/dtos';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { plotGroupPath } from '../plotGroupClient';
import { savePlotGroup } from '../savePlotGroup';

const FARM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLOT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T0 = '2026-11-20T06:00:00.0000000Z';
const T1 = '2026-11-20T07:00:00.0000000Z';
const T2 = '2026-11-20T08:00:00.0000000Z';

const plotDto = (over: Partial<PlotDto> = {}): PlotDto => ({
    id: PLOT, farmId: FARM, name: 'G7', areaInAcres: 0.5, createdAtUtc: T0, modifiedAtUtc: T0, ...over,
});

const asResponse = (data: unknown) => ({ data, status: 200 });
const serves = (data: unknown) => vi.spyOn(agriSyncClient.http, 'put').mockResolvedValue(asResponse(data) as never);
const refuses = (status: number, data?: unknown) => vi.spyOn(agriSyncClient.http, 'put').mockRejectedValue({ response: { status, data } });

async function hold(payload: PlotDto = plotDto()) {
    await getDatabase().plots.put({ id: payload.id, farmId: payload.farmId, payload, updatedAt: '2026-11-20T06:00:01.000Z' });
}
const held = async () => getDatabase().plots.get(PLOT);

describe('savePlotGroup', () => {
    beforeEach(async () => {
        await getDatabase().plots.clear();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });
    afterEach(() => {
        vi.restoreAllMocks();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('asks the server (PUT the plot\'s group path) and keeps the SERVER\'S answer in the phone\'s copy', async () => {
        await hold();
        const put = serves(plotDto({ groupName: 'विहिरीजवळचे', modifiedAtUtc: T1 }));

        const result = await savePlotGroup(PLOT, '  विहिरीजवळचे ');

        expect(put).toHaveBeenCalledTimes(1);
        expect(put).toHaveBeenCalledWith(plotGroupPath(FARM, PLOT), { groupName: 'विहिरीजवळचे' });
        expect(result).toEqual({ saved: true, plot: expect.objectContaining({ id: PLOT, groupName: 'विहिरीजवळचे', modifiedAtUtc: T1 }) });
        const record = await held();
        expect(record?.payload).toEqual(expect.objectContaining({ groupName: 'विहिरीजवळचे', modifiedAtUtc: T1 }));
        expect(record?.farmId).toBe(FARM);
    });

    it('adopts what the server answers, not what was asked (the server\'s own trimmed name)', async () => {
        await hold();
        serves(plotDto({ groupName: 'वरचा भाग', modifiedAtUtc: T1 }));
        const result = await savePlotGroup(PLOT, 'वरचा भाग   ');
        expect(result.saved && result.plot.groupName).toBe('वरचा भाग');
    });

    it('clears the group: a blank name is sent as null and the server\'s null is kept', async () => {
        await hold(plotDto({ groupName: 'X' }));
        const put = serves(plotDto({ groupName: null, modifiedAtUtc: T1 }));
        const result = await savePlotGroup(PLOT, '   ');
        expect(put).toHaveBeenCalledWith(plotGroupPath(FARM, PLOT), { groupName: null });
        expect(result).toEqual({ saved: true, plot: expect.objectContaining({ groupName: null }) });
        expect((await held())?.payload).toEqual(expect.objectContaining({ groupName: null }));
    });

    it('does not write an older answer over a newer edit a pull already brought in', async () => {
        await hold(plotDto({ groupName: 'दुसऱ्याचे', modifiedAtUtc: T2 }));
        serves(plotDto({ groupName: 'माझे', modifiedAtUtc: T1 }));
        const result = await savePlotGroup(PLOT, 'माझे');
        expect(result).toEqual({ saved: true, plot: expect.objectContaining({ groupName: 'दुसऱ्याचे' }) });
        expect((await held())?.payload).toEqual(expect.objectContaining({ groupName: 'दुसऱ्याचे', modifiedAtUtc: T2 }));
    });

    describe('every way of not saving leaves the phone\'s copy exactly as it was', () => {
        const before = plotDto({ groupName: 'जुने', modifiedAtUtc: T1 });
        beforeEach(async () => { await hold(before); });
        const unchanged = async () => {
            const record = await held();
            expect(record?.payload).toEqual(before);
            expect(record?.updatedAt).toBe('2026-11-20T06:00:01.000Z');
        };

        it('offline: nothing is sent', async () => {
            Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
            const put = serves(plotDto());
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'offline' });
            expect(put).not.toHaveBeenCalled();
            await unchanged();
        });

        it('a network failure with no answer is offline', async () => {
            vi.spyOn(agriSyncClient.http, 'put').mockRejectedValue({ code: 'ERR_NETWORK', message: 'Network Error' });
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'offline' });
            await unchanged();
        });

        it('403: this seat may not edit the farm setup', async () => {
            refuses(403);
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'not_allowed' });
            await unchanged();
        });

        it('404 named by the server (plot not found): not_found', async () => {
            refuses(404, { error: 'ShramSafal.PlotNotFound', message: 'Plot was not found.' });
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'not_found' });
            await unchanged();
        });

        it('404 naming the farm: not_found', async () => {
            refuses(404, { error: 'ShramSafal.FarmNotFound', message: 'Farm was not found.' });
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'not_found' });
            await unchanged();
        });

        it('404 with no server error (an older server has no such route): old_server', async () => {
            refuses(404);
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'old_server' });
            refuses(404, '<html>Not Found</html>');
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'old_server' });
            await unchanged();
        });

        it('405: old_server', async () => {
            refuses(405);
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'old_server' });
            await unchanged();
        });

        it('a server fault, a refusal of the name and a thrown error: failed', async () => {
            refuses(500);
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'failed' });
            refuses(400, { error: 'ShramSafal.InvalidCommand' });
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'failed' });
            vi.spyOn(agriSyncClient.http, 'put').mockRejectedValue(new Error('boom'));
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'failed' });
            await unchanged();
        });

        it('an answer that is not a plot, or is another plot: failed', async () => {
            serves({ ok: true });
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'failed' });
            serves(plotDto({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', groupName: 'नवे' }));
            expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'failed' });
            await unchanged();
        });

        it('a name longer than 30 characters is never sent: failed', async () => {
            const put = serves(plotDto());
            expect(await savePlotGroup(PLOT, 'अ'.repeat(31))).toEqual({ saved: false, reason: 'failed' });
            expect(put).not.toHaveBeenCalled();
            await unchanged();
        });

        it('30 characters is allowed', async () => {
            const name = 'अ'.repeat(30);
            const put = serves(plotDto({ groupName: name, modifiedAtUtc: T2 }));
            expect((await savePlotGroup(PLOT, name)).saved).toBe(true);
            expect(put).toHaveBeenCalledTimes(1);
        });
    });

    it('a plot this phone does not hold is not_found, and nothing is sent', async () => {
        const put = serves(plotDto());
        expect(await savePlotGroup(PLOT, 'नवे')).toEqual({ saved: false, reason: 'not_found' });
        expect(put).not.toHaveBeenCalled();
        expect(await held()).toBeUndefined();
    });
});
