// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useWeatherMonitor } from '../useWeatherMonitor';

// Unmount the hook after each test so its stale-response cleanup fires — otherwise
// a slow async fetch resolves after jsdom teardown ("window is not defined").
afterEach(cleanup);

type Props = Parameters<typeof useWeatherMonitor>[0];

const FARM_ID = '11111111-1111-4111-8111-111111111111';

const baseProfile = (location?: { lat: number; lon: number }): Props['farmerProfile'] =>
    ({ name: 'T', operators: [], activeOperatorId: null, location }) as unknown as Props['farmerProfile'];

const sampleStamp = {
    id: 'w', plotId: 'device', timestampLocal: '', timestampProvider: '',
    provider: 'tomorrow.io', tempC: 25, humidity: 50, windKph: 5, precipMm: 0,
    cloudCoverPct: 10, conditionText: 'Sunny', iconCode: '1000', rainProbNext6h: 0,
};

const okProvider = (): Props['provider'] => ({
    getForecast: vi.fn(async () => []),
    getCurrentWeather: vi.fn(async () => ({ ...sampleStamp, plotId: 'farm' })),
    getCurrentWeatherByCoords: vi.fn(async () => ({ ...sampleStamp })),
    getForecastByCoords: vi.fn(async () => []),
    detectWeatherChanges: vi.fn(() => null),
}) as unknown as Props['provider'];

const farmGeoWithCentre = (): Props['farmGeography'] =>
    ({ getFarmCentre: vi.fn(async () => ({ lat: 20.1, lng: 73.7 })) }) as unknown as Props['farmGeography'];

const props = (over: Partial<Props>): Props => ({
    farmerProfile: baseProfile(), crops: [], setCrops: vi.fn(),
    hasActiveLogContext: false, activeCropId: null, activePlotId: null, activeFarmId: null,
    setError: vi.fn(), provider: okProvider(), farmGeography: undefined, ...over,
}) as unknown as Props;

describe('useWeatherMonitor status', () => {
    it('is "no-location" (boundaryUnset) when no farm centre, no profile location, no device GPS', async () => {
        const { result } = renderHook(() => useWeatherMonitor(props({})));
        await waitFor(() => expect(result.current.weatherStatus).toBe('no-location'));
        expect(result.current.boundaryUnset).toBe(true);
    });

    it('farm centre → farm-anchored weather, no caution', async () => {
        const { result } = renderHook(() => useWeatherMonitor(props({
            farmGeography: farmGeoWithCentre(), activeFarmId: FARM_ID,
        })));
        await waitFor(() => expect(result.current.weatherStatus).toBe('ready'));
        expect(result.current.boundaryUnset).toBe(false);
        expect(result.current.weatherData).toBeDefined();
    });

    it('no centre + saved profile location → coord weather with boundaryUnset', async () => {
        const { result } = renderHook(() => useWeatherMonitor(props({
            farmerProfile: baseProfile({ lat: 20.1, lon: 73.7 }),
        })));
        await waitFor(() => expect(result.current.weatherStatus).toBe('ready'));
        expect(result.current.boundaryUnset).toBe(true);
    });

    it('no centre + no profile + consented device GPS → device weather with boundaryUnset', async () => {
        const getDeviceLocation = vi.fn(async () => ({ lat: 21, lon: 74 }));
        const { result } = renderHook(() => useWeatherMonitor(props({ getDeviceLocation })));
        await waitFor(() => expect(result.current.weatherStatus).toBe('ready'));
        expect(result.current.boundaryUnset).toBe(true);
        expect(getDeviceLocation).toHaveBeenCalled();
    });

    it('is "error" when the coord fetch fails', async () => {
        const failing = {
            ...okProvider(),
            getForecastByCoords: vi.fn(async () => { throw new Error('boom'); }),
        } as unknown as Props['provider'];
        const { result } = renderHook(() => useWeatherMonitor(props({
            farmerProfile: baseProfile({ lat: 20.1, lon: 73.7 }), provider: failing,
        })));
        await waitFor(() => expect(result.current.weatherStatus).toBe('error'));
    });

    it('stays "ready" when change-detection throws after data loads', async () => {
        const throwing = {
            ...okProvider(),
            detectWeatherChanges: vi.fn(() => { throw new Error('detect boom'); }),
        } as unknown as Props['provider'];
        const { result } = renderHook(() => useWeatherMonitor(props({
            farmerProfile: baseProfile({ lat: 20.1, lon: 73.7 }), provider: throwing,
        })));
        await waitFor(() => expect(result.current.weatherStatus).toBe('ready'));
        expect(result.current.weatherData).toBeDefined();
    });

    it('exposes a refetchWeather function', () => {
        const { result } = renderHook(() => useWeatherMonitor(props({})));
        expect(typeof result.current.refetchWeather).toBe('function');
    });
});
