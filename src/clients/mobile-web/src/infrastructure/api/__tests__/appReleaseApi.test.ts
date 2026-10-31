/**
 * Lane UPD-1 — reading `GET /version/app`: the right path, every field may be null, a wrong shape or a
 * failed answer throws (the caller logs it and shows nothing).
 */
import { describe, expect, it, vi } from 'vitest';
import { APP_RELEASE_PATH, fetchAppRelease, parseAppRelease } from '../appReleaseApi';

const answer = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as unknown as Response;

describe('appReleaseApi (UPD-1)', () => {
    it('asks the anonymous /version/app path and reads the four fields', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(answer(200, {
            latestVersion: '1.0.19', minimumVersion: null, playStoreUrl: 'https://play.google.com/x', apkUrl: 'https://shramsafal.in/apk',
        }));
        await expect(fetchAppRelease(fetchImpl as unknown as typeof fetch)).resolves.toEqual({
            latestVersion: '1.0.19', minimumVersion: null, playStoreUrl: 'https://play.google.com/x', apkUrl: 'https://shramsafal.in/apk',
        });
        expect(APP_RELEASE_PATH).toBe('/version/app');
        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect(url.endsWith('/version/app')).toBe(true);
        expect(new Headers(init.headers).has('Authorization')).toBe(false);
    });

    it('missing fields are null (nothing announced)', () => {
        expect(parseAppRelease({})).toEqual({ latestVersion: null, minimumVersion: null, playStoreUrl: null, apkUrl: null });
    });

    it('a wrong shape throws', () => {
        expect(() => parseAppRelease({ latestVersion: 1.019 })).toThrow();
        expect(() => parseAppRelease('1.0.19')).toThrow();
        expect(() => parseAppRelease(null)).toThrow();
    });

    it('a non-2xx answer throws', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(answer(503, {}));
        await expect(fetchAppRelease(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/503/);
    });

    it('a network failure throws', async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(fetchAppRelease(fetchImpl as unknown as typeof fetch)).rejects.toThrow('Failed to fetch');
    });
});
