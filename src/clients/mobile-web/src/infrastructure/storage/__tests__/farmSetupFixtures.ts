/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone half) - the pull's `farmSetup` entries, copied from the server
 * builder's report (SERVER-REPORT.md §2: "a farm with one of everything, exactly as a worker of the farm pulled it in the test run",
 * and the empty farm "exactly as sent"). Shared by the phone half's tests so every one of them reads the server's real shape.
 */
export const FARM_A = '3d030000-0000-4000-8000-0000000000a1';
export const FARM_B = '3d030000-0000-4000-8000-0000000000b1';
export const PLOT_A = '3d030000-0000-4000-8000-0000000000a3';
export const SOURCE_A = 'd9aa0000-0000-4000-8000-000000000001';
export const MOTOR_A1 = 'd9aa0000-0000-4000-8000-000000000011';
export const MOTOR_A2 = 'd9aa0000-0000-4000-8000-000000000012';
export const MACHINE_A = 'd9aa0000-0000-4000-8000-000000000021';

/** SERVER-REPORT §2, byte for byte in meaning (numbers as JSON numbers: `5.00` reads as 5). */
export const fullFarmDto = (): Record<string, unknown> => ({
    farmId: FARM_A,
    waterSources: [{
        id: SOURCE_A, revision: 1, name: 'मुख्य विहीर', sourceType: 'well', isAvailable: true, notes: null,
        motors: [
            { id: MOTOR_A1, name: '५ एचपी', hp: 5.0, phase: 3, powerSource: 'mseb', powerSourceName: null, drip: { pipeSize: '16mm', hasFilter: true, flowLitresPerHour: 4.0 } },
            { id: MOTOR_A2, name: '७.५ एचपी', hp: 7.5, phase: 3, powerSource: 'mseb', powerSourceName: null, drip: null },
        ],
        updatedAtUtc: '2026-11-26T20:51:09.705974Z',
    }],
    powerTimes: {
        revision: 1, updatedAtUtc: '2026-11-26T20:51:09.848475Z',
        timetable: {
            singlePhase: {
                patternMode: 'FIXED_WEEKLY', alternateWeeklyPattern: false,
                weekAOffWindows: [{ id: 'w1', startTime: '06:00', endTime: '14:00', repeatRule: 'WEEKLY', days: ['Mon', 'Tue'] }], weekBOffWindows: [],
            },
            threePhase: { patternMode: 'ROTATIONAL', alternateWeeklyPattern: true, weekAOffWindows: [], weekBOffWindows: [] },
        },
    },
    machines: [{
        id: MACHINE_A, revision: 1, name: 'महिंद्रा 575', machineType: 'tractor', ownership: 'owned',
        company: null, model: null, hp: null, nozzleCount: null, tankLitres: null, detailLine: null, updatedAtUtc: '2026-11-26T20:51:09.900779Z',
    }],
    plotWater: [{
        plotId: PLOT_A, revision: 1, method: 'drip', links: [{ waterSourceId: SOURCE_A, motorId: MOTOR_A1 }], updatedAtUtc: '2026-11-26T20:51:09.947159Z',
    }],
});

/** SERVER-REPORT §2: "An empty farm, exactly as sent". */
export const emptyFarmDto = (farmId: string): Record<string, unknown> => ({ farmId, waterSources: [], powerTimes: null, machines: [], plotWater: [] });
