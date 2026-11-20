// spec: plr-d10-redesign-real-integration-2026-10-25 (lane GRP-1a) - a pull carries the plot's group label onto the plot the screens
// read (`Plot.groupName`), a cleared label clears it, and an older server (no field at all) leaves a plot exactly as it was.
import { describe, expect, it } from 'vitest';

import type { CropCycleDto, PlotDto } from '../../../../../infrastructure/api/AgriSyncClient';
import type { CropProfile } from '../../../../../types';
import { upsertPlot } from '../plotSchedule';

const FARM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLOT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const crop = (): CropProfile => ({ id: 'grapes', name: 'Grapes', plots: [] } as unknown as CropProfile);
const dto = (over: Partial<PlotDto> = {}): PlotDto => ({
    id: PLOT, farmId: FARM, name: 'G7', areaInAcres: 0.5, createdAtUtc: '2026-11-01T00:00:00Z', modifiedAtUtc: '2026-11-01T00:00:00Z', ...over,
});
const cycle = { id: 'cy1', farmId: FARM, plotId: PLOT, cropName: 'Grapes', stage: 'unstated', startDate: '2026-11-01' } as unknown as CropCycleDto;

describe('upsertPlot and the owner\'s group label', () => {
    it('puts the label on a new plot, trimmed', () => {
        const c = crop();
        upsertPlot(c, dto({ groupName: '  विहिरीजवळचे ' }), cycle, null);
        expect(c.plots[0].groupName).toBe('विहिरीजवळचे');
    });

    it('leaves a plot with no label without a groupName at all (an older server, or a plot never grouped)', () => {
        const c = crop();
        upsertPlot(c, dto(), cycle, null);
        expect('groupName' in c.plots[0]).toBe(false);
        upsertPlot(c, dto(), cycle, null);
        expect('groupName' in c.plots[0]).toBe(false);
    });

    it('updates the label of a plot the phone already has, and a blank label clears it', () => {
        const c = crop();
        upsertPlot(c, dto(), cycle, null);
        upsertPlot(c, dto({ groupName: 'वरचा भाग' }), cycle, null);
        expect(c.plots[0].groupName).toBe('वरचा भाग');
        upsertPlot(c, dto({ groupName: 'खालचा भाग' }), cycle, null);
        expect(c.plots[0].groupName).toBe('खालचा भाग');
        upsertPlot(c, dto({ groupName: '   ' }), cycle, null);
        expect(c.plots[0].groupName ?? null).toBeNull();
        expect(c.plots).toHaveLength(1);
    });
});
