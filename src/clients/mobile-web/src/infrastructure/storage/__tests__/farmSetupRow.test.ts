/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P1) - the pull's `farmSetup` entry read into the phone's rows. The server
 * sends an unknown optional detail as `null` (SERVER-REPORT §2): it is kept as null, never invented. A row that cannot be read is SKIPPED and counted,
 * never stored half - and a water source with one unreadable motor is skipped whole, because its next save sends its whole motor list and a motor
 * dropped here would be removed on the server by that save.
 */
import { describe, expect, it } from 'vitest';
import { farmSetupFromDto } from '../farmSetupRow';
import { FARM_A, MACHINE_A, MOTOR_A1, MOTOR_A2, PLOT_A, SOURCE_A, emptyFarmDto, fullFarmDto } from './farmSetupFixtures';

describe('farmSetupRow - one farm entry of the pull as the phone keeps it', () => {
    it('reads the server example exactly, nulls kept as null', () => {
        const read = farmSetupFromDto(fullFarmDto(), '2026-11-27T10:00:00Z');
        expect(read).not.toBeNull();
        expect(read!.skipped).toBe(0);
        const set = read!.set;
        expect(set.farmId).toBe(FARM_A);
        expect(set.waterSources).toEqual([{
            id: SOURCE_A, farmId: FARM_A, revision: 1, name: 'मुख्य विहीर', sourceType: 'well', isAvailable: true, notes: null,
            motors: [
                { id: MOTOR_A1, name: '५ एचपी', hp: 5, phase: 3, powerSource: 'mseb', powerSourceName: null, drip: { pipeSize: '16mm', hasFilter: true, flowLitresPerHour: 4 } },
                { id: MOTOR_A2, name: '७.५ एचपी', hp: 7.5, phase: 3, powerSource: 'mseb', powerSourceName: null, drip: null },
            ],
            updatedAtUtc: '2026-11-26T20:51:09.705974Z',
        }]);
        expect(set.powerTimes?.revision).toBe(1);
        expect(set.powerTimes?.timetable.singlePhase.weekAOffWindows[0]).toEqual({ id: 'w1', startTime: '06:00', endTime: '14:00', repeatRule: 'WEEKLY', days: ['Mon', 'Tue'] });
        expect(set.powerTimes?.timetable.threePhase.weekBOffWindows).toEqual([]);
        expect(set.machines).toEqual([{
            id: MACHINE_A, farmId: FARM_A, revision: 1, name: 'महिंद्रा 575', machineType: 'tractor', ownership: 'owned',
            company: null, model: null, hp: null, nozzleCount: null, tankLitres: null, detailLine: null, updatedAtUtc: '2026-11-26T20:51:09.900779Z',
        }]);
        expect(set.plotWater).toEqual([{
            plotId: PLOT_A, farmId: FARM_A, revision: 1, method: 'drip', links: [{ waterSourceId: SOURCE_A, motorId: MOTOR_A1 }], updatedAtUtc: '2026-11-26T20:51:09.947159Z',
        }]);
        expect(set.receivedAtUtc).toBe('2026-11-27T10:00:00Z');
    });

    it('an empty farm is an answer: no rows, no power times, still a set', () => {
        const read = farmSetupFromDto(emptyFarmDto(FARM_A), 'now');
        expect(read!.set).toEqual({ farmId: FARM_A, waterSources: [], powerTimes: null, machines: [], plotWater: [], receivedAtUtc: 'now' });
    });

    it('farmSetupRow skips an unreadable row', () => {
        const dto = fullFarmDto();
        const sources = dto.waterSources as Record<string, unknown>[];
        sources.push({ id: 'not-a-guid', revision: 1, name: 'x', sourceType: 'well', isAvailable: true, notes: null, motors: [], updatedAtUtc: 't' });
        // a source with one motor of a phase that is neither 1 nor 3: the WHOLE source is skipped
        sources.push({ ...sources[0], id: 'd9aa0000-0000-4000-8000-0000000000f1', motors: [{ ...(sources[0].motors as Record<string, unknown>[])[1], phase: 2 }] });
        (dto.machines as Record<string, unknown>[]).push({ id: MACHINE_A.replace('21', '22'), revision: 0, name: 'y', machineType: 'tractor', ownership: 'owned', updatedAtUtc: 't' });
        (dto.plotWater as Record<string, unknown>[]).push({ plotId: PLOT_A.replace('a3', 'a4'), revision: 1, method: 'pipe', links: [], updatedAtUtc: 't' });
        dto.powerTimes = { revision: 2, updatedAtUtc: 't', timetable: { singlePhase: { patternMode: 'FIXED_WEEKLY' } } };
        const read = farmSetupFromDto(dto, 'now')!;
        expect(read.set.waterSources.map(s => s.id)).toEqual([SOURCE_A]);
        expect(read.set.machines.map(m => m.id)).toEqual([MACHINE_A]);
        expect(read.set.plotWater.map(p => p.plotId)).toEqual([PLOT_A]);
        expect(read.set.powerTimes).toBeNull();
        expect(read.skipped).toBe(5);
    });

    it('an entry with no readable farm id is no entry at all', () => {
        expect(farmSetupFromDto({ ...emptyFarmDto(FARM_A), farmId: 42 }, 'now')).toBeNull();
        expect(farmSetupFromDto(null, 'now')).toBeNull();
        expect(farmSetupFromDto({ farmId: FARM_A }, 'now')).toBeNull();
    });
});
