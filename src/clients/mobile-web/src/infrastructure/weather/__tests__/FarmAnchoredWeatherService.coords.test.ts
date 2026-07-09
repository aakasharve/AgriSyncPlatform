import { describe, it, expect, vi } from 'vitest';
import { FarmAnchoredWeatherService } from '../FarmAnchoredWeatherService';

describe('FarmAnchoredWeatherService coordinate forwarding', () => {
    it('exposes + forwards the coord methods to the inner client (raw coords, not farm-anchored)', async () => {
        const inner = {
            getCurrentWeather: vi.fn(),
            getForecast: vi.fn(),
            getCurrentWeatherByCoords: vi.fn(async () => ({ id: 'w', plotId: 'device' })),
            getForecastByCoords: vi.fn(async () => ([{ date: '2026-07-09' }])),
        };
        const farmGeography = { getFarmCentre: vi.fn() };
        const svc = new FarmAnchoredWeatherService(inner as never, farmGeography as never, () => 'farm-1');

        // The useWeatherMonitor capability guard checks these exist on the wrapper.
        expect(typeof svc.getCurrentWeatherByCoords).toBe('function');
        expect(typeof svc.getForecastByCoords).toBe('function');

        await svc.getCurrentWeatherByCoords(20.1, 73.7);
        expect(inner.getCurrentWeatherByCoords).toHaveBeenCalledWith(20.1, 73.7);
        // farm-centre resolution must NOT run for coord weather
        expect(farmGeography.getFarmCentre).not.toHaveBeenCalled();

        await svc.getForecastByCoords(20.1, 73.7, 7);
        expect(inner.getForecastByCoords).toHaveBeenCalledWith(20.1, 73.7, 7);
    });
});
