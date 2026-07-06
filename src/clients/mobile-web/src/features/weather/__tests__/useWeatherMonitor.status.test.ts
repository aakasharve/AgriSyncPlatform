// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWeatherMonitor } from '../useWeatherMonitor';
import { WeatherFetchError } from '../../../infrastructure/weather/WeatherFetchError';

type Props = Parameters<typeof useWeatherMonitor>[0];

const baseProfile = (location?: { lat: number; lon: number }): Props['farmerProfile'] =>
    ({ name: 'T', operators: [], activeOperatorId: null, location }) as unknown as Props['farmerProfile'];

const okProvider = (): Props['provider'] => ({
    getForecast: vi.fn(async () => []),
    getCurrentWeather: vi.fn(async () => ({
        id: 'w', plotId: 'farm', timestampLocal: '', timestampProvider: '',
        provider: 'tomorrow.io', tempC: 25, humidity: 50, windKph: 5, precipMm: 0,
        cloudCoverPct: 10, conditionText: 'Sunny', iconCode: '1000', rainProbNext6h: 0,
    })),
    detectWeatherChanges: vi.fn(() => null),
}) as unknown as Props['provider'];

const props = (over: Partial<Props>): Props => ({
    farmerProfile: baseProfile(), crops: [], setCrops: vi.fn(),
    logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
    hasActiveLogContext: false, activeCropId: null, activePlotId: null, activeFarmId: null,
    setError: vi.fn(), provider: okProvider(), farmGeography: undefined, ...over,
}) as unknown as Props;

describe('useWeatherMonitor status', () => {
    it('is "no-location" when no farm centre and no profile location', async () => {
        const { result } = renderHook(() => useWeatherMonitor(props({})));
        await waitFor(() => expect(result.current.weatherStatus).toBe('no-location'));
    });

    it('is "ready" when coordinates resolve and fetch succeeds', async () => {
        const { result } = renderHook(() => useWeatherMonitor(props({
            farmerProfile: baseProfile({ lat: 20.1, lon: 73.7 }),
        })));
        await waitFor(() => expect(result.current.weatherStatus).toBe('ready'));
        expect(result.current.weatherData).toBeDefined();
    });

    it('is "error" when the fetch fails with a non-centre error', async () => {
        const failing = {
            ...okProvider(),
            getForecast: vi.fn(async () => { throw new WeatherFetchError(503, 'ShramSafal.WeatherProviderNotConfigured'); }),
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
