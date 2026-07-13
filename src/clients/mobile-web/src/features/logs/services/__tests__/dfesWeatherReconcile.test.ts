/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesWeatherReconcile — unit tests (Task 4B TDD plan, spec:
 * dfes-companion-2026-07-11).
 */
import { describe, it, expect } from 'vitest';
import type { DailyLog } from '../../../../domain/types/log.types';
import type { WeatherStamp } from '../../../../domain/types/weather.types';
import { reconcileWeather, SEVERE_PRECIP_MM, SEVERE_WIND_GUST_KPH } from '../dfesWeatherReconcile';

const baseStamp: WeatherStamp = {
    id: 'ws-1', plotId: 'plot-1', timestampLocal: '2026-07-11T06:00:00', timestampProvider: '2026-07-11T06:00:00Z',
    provider: 'tomorrow.io', tempC: 28, humidity: 60, windKph: 10, precipMm: 2, cloudCoverPct: 40,
    conditionText: 'Light rain', iconCode: '1000', rainProbNext6h: 20,
};

function makeLog(overrides: Partial<DailyLog> = {}): DailyLog {
    return {
        id: 'log-1', date: '2026-07-11',
        context: { selection: [] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        ...overrides,
    };
}

describe('reconcileWeather (Task 4B)', () => {
    it('returns a severe context when precipMm >= threshold and no weather disturbance logged', () => {
        const log = makeLog({ weatherStamp: { ...baseStamp, precipMm: 20 } });
        const result = reconcileWeather(log);
        expect(result).toEqual({ severity: 'severe', reason: expect.stringContaining('precipMm 20') });
    });

    it('returns null when the farmer already logged disturbance.cause === WEATHER, even with a severe stamp', () => {
        const log = makeLog({
            weatherStamp: { ...baseStamp, precipMm: 20 },
            disturbance: { scope: 'FULL_DAY', group: 'weather', reason: 'heavy rain', blockedSegments: [], cause: 'WEATHER' },
        });
        expect(reconcileWeather(log)).toBeNull();
    });

    it('returns null for ordinary/light weather (precipMm 2, windKph 10) — never nags on ordinary rain', () => {
        const log = makeLog({ weatherStamp: { ...baseStamp, precipMm: 2, windKph: 10 } });
        expect(reconcileWeather(log)).toBeNull();
    });

    it('returns null when there is no weatherStamp at all', () => {
        const log = makeLog();
        expect(reconcileWeather(log)).toBeNull();
    });

    it('returns null for an undefined savedLog', () => {
        expect(reconcileWeather(undefined)).toBeNull();
    });

    it('returns a severe context when an alert is present, even with otherwise-ordinary precip/wind, and no disturbance logged', () => {
        const log = makeLog({ weatherStamp: { ...baseStamp, precipMm: 2, windKph: 10, alerts: ['Storm Warning'] } });
        const result = reconcileWeather(log);
        expect(result).toEqual({ severity: 'severe', reason: expect.stringContaining('alerts 1') });
    });

    it('returns a severe context on damaging gust (>= threshold), falling back to windKph when no gust field', () => {
        const log = makeLog({ weatherStamp: { ...baseStamp, precipMm: 2, windKph: SEVERE_WIND_GUST_KPH } });
        const result = reconcileWeather(log);
        expect(result).toEqual({ severity: 'severe', reason: expect.stringContaining('windGust') });
    });

    it('honours windGustKph over windKph when both present', () => {
        const log = makeLog({ weatherStamp: { ...baseStamp, precipMm: 2, windKph: 10, windGustKph: SEVERE_WIND_GUST_KPH } });
        const result = reconcileWeather(log);
        expect(result).toEqual({ severity: 'severe', reason: expect.stringContaining('windGust') });
    });

    it('stays inert just below the precip threshold', () => {
        const log = makeLog({ weatherStamp: { ...baseStamp, precipMm: SEVERE_PRECIP_MM - 0.1 } });
        expect(reconcileWeather(log)).toBeNull();
    });
});
