/**
 * spec: 2026-08-25-prod-cutover-waves
 * Origin selection for user-shareable absolute URLs. Inside the Capacitor APK
 * window.location.origin is https://localhost, which nobody else can open.
 */
import { describe, it, expect } from 'vitest';
import { resolveShareOrigin, normalizeOrigin, DEFAULT_PUBLIC_WEB_ORIGIN } from './publicWebOrigin';

describe('resolveShareOrigin', () => {
    it('web keeps the current origin', () => {
        expect(resolveShareOrigin({ isNative: false, windowOrigin: 'https://app.shramsafal.in', configured: undefined }))
            .toBe('https://app.shramsafal.in');
    });
    it('web on a dev origin keeps it too', () => {
        expect(resolveShareOrigin({ isNative: false, windowOrigin: 'http://localhost:5173', configured: undefined }))
            .toBe('http://localhost:5173');
    });
    it('native uses the public web origin, never https://localhost', () => {
        expect(resolveShareOrigin({ isNative: true, windowOrigin: 'https://localhost', configured: undefined }))
            .toBe(DEFAULT_PUBLIC_WEB_ORIGIN);
        expect(DEFAULT_PUBLIC_WEB_ORIGIN).toBe('https://app.shramsafal.in');
    });
    it('native honours a configured override', () => {
        expect(resolveShareOrigin({ isNative: true, windowOrigin: 'https://localhost', configured: 'https://staging.example.in/' }))
            .toBe('https://staging.example.in');
    });
    it('native falls back to the default on a blank or invalid override', () => {
        for (const bad of ['', '   ', 'not a url', 'javascript:alert(1)', 'http://localhost']) {
            expect(resolveShareOrigin({ isNative: true, windowOrigin: 'https://localhost', configured: bad }))
                .toBe(DEFAULT_PUBLIC_WEB_ORIGIN);
        }
    });
    it('normalizeOrigin strips path and trailing slash', () => {
        expect(normalizeOrigin('https://a.in/x/y')).toBe('https://a.in');
        expect(normalizeOrigin('ftp://a.in')).toBeNull();
    });
});
