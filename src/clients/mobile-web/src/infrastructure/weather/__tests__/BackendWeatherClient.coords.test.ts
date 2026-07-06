// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BackendWeatherClient } from '../BackendWeatherClient';
import { WeatherFetchError } from '../WeatherFetchError';

afterEach(() => vi.restoreAllMocks());

const snapshotDto = {
    provider: 'tomorrow.io', observedAtUtc: '2026-07-06T00:00:00Z', tempC: 25, humidity: 50,
    windKph: 5, windGustKph: null, precipMm: 0, cloudCoverPct: 10, conditionText: 'Clear',
    iconCode: '1000', rainProbNext6h: 0, uvIndex: null, soilMoistureVolumetric0To10: null,
};

describe('BackendWeatherClient coordinate methods', () => {
    it('getCurrentWeatherByCoords hits the coord endpoint and maps to a device stamp', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(snapshotDto), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new BackendWeatherClient(() => null); // no active farm needed
        const stamp = await client.getCurrentWeatherByCoords(20.1, 73.7);
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/shramsafal/weather/current?lat=20.1&lon=73.7');
        expect(stamp.plotId).toBe('device');
        expect(stamp.tempC).toBe(25);
    });

    it('getForecastByCoords hits the coord forecast endpoint with days', async () => {
        const forecastDtos = [{ date: '2026-07-06', tempMinC: 20, tempMaxC: 30, rainMm: 0, windSpeedKph: 5, humidity: 50, condition: 'Sunny' }];
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(forecastDtos), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new BackendWeatherClient(() => null);
        const forecast = await client.getForecastByCoords(20.1, 73.7, 5);
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/shramsafal/weather/forecast?lat=20.1&lon=73.7&days=5');
        expect(forecast).toHaveLength(1);
        expect(forecast[0].tempMax).toBe(30);
    });

    it('throws WeatherFetchError on 503', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'ShramSafal.WeatherProviderNotConfigured' }), { status: 503 })));
        const client = new BackendWeatherClient(() => null);
        const err = await client.getCurrentWeatherByCoords(20.1, 73.7).catch(e => e);
        expect(err).toBeInstanceOf(WeatherFetchError);
        expect(err.status).toBe(503);
    });
});
