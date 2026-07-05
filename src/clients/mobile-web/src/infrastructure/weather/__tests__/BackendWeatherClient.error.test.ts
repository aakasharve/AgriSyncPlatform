// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BackendWeatherClient } from '../BackendWeatherClient';
import { WeatherFetchError, isFarmCentreMissing } from '../WeatherFetchError';

const geo = { lat: 20, lon: 73, source: 'approx' as const };

afterEach(() => vi.restoreAllMocks());

describe('BackendWeatherClient error surfacing', () => {
    it('throws WeatherFetchError with status + backend code on 400 FarmCentreMissing', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify({ error: 'ShramSafal.FarmCentreMissing', message: 'no centre' }),
            { status: 400 },
        )));
        const client = new BackendWeatherClient(() => 'farm-1');
        const err = await client.getCurrentWeather(geo).catch(e => e);
        expect(err).toBeInstanceOf(WeatherFetchError);
        expect(err.status).toBe(400);
        expect(err.code).toBe('ShramSafal.FarmCentreMissing');
        expect(isFarmCentreMissing(err)).toBe(true);
    });

    it('throws WeatherFetchError with status 503 when provider unconfigured', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify({ error: 'ShramSafal.WeatherProviderNotConfigured', message: 'no key' }),
            { status: 503 },
        )));
        const client = new BackendWeatherClient(() => 'farm-1');
        const err = await client.getForecast(geo).catch(e => e);
        expect(err).toBeInstanceOf(WeatherFetchError);
        expect(err.status).toBe(503);
    });
});
