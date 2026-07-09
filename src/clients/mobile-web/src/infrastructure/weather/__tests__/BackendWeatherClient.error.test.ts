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

describe('isFarmCentreMissing', () => {
    it('keys off the FarmCentreMissing code, not the 400 status', () => {
        expect(isFarmCentreMissing(new WeatherFetchError(400, 'ShramSafal.FarmCentreMissing'))).toBe(true);
        // A non-centre 400 (the backend maps many errors to 400) must NOT be
        // treated as a missing farm centre.
        expect(isFarmCentreMissing(new WeatherFetchError(400, 'ShramSafal.InvalidCommand'))).toBe(false);
        expect(isFarmCentreMissing(new WeatherFetchError(503, 'ShramSafal.WeatherProviderNotConfigured'))).toBe(false);
        expect(isFarmCentreMissing(new Error('network down'))).toBe(false);
    });
});
