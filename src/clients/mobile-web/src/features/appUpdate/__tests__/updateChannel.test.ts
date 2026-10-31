/**
 * Lane UPD-1 — where "अपडेट करा" goes: each channel to its place, and ONLY allow-listed places.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../infrastructure/observability/Logger';
import {
    BUILT_IN_APK_URL, BUILT_IN_PLAY_URL, deviceOpener, effectiveUpdateChannel, goToUpdate, isAllowedPlayUrl, isAllowedSiteUrl,
    parseUpdateChannel, resolveUpdateTarget, type UpdateOpener,
} from '../updateChannel';

const fakeOpener = () => {
    const opener = { open: vi.fn<(url: string) => void>(), reload: vi.fn<() => void>() };
    return opener satisfies UpdateOpener;
};

afterEach(() => { vi.restoreAllMocks(); });

describe('the build-time channel (VITE_UPDATE_CHANNEL)', () => {
    it('reads play / site / web, any case; empty means web', () => {
        expect(parseUpdateChannel('play')).toBe('play');
        expect(parseUpdateChannel(' SITE ')).toBe('site');
        expect(parseUpdateChannel('web')).toBe('web');
        expect(parseUpdateChannel('')).toBe('web');
        expect(parseUpdateChannel(undefined)).toBe('web');
    });

    it('an unknown value means web, and is logged', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        expect(parseUpdateChannel('store')).toBe('web');
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('an installed app built as web goes to the APK page (a reload installs nothing); a browser keeps its setting', () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        expect(effectiveUpdateChannel('web', true)).toBe('site');
        expect(effectiveUpdateChannel('play', true)).toBe('play');
        expect(effectiveUpdateChannel('site', true)).toBe('site');
        expect(effectiveUpdateChannel('web', false)).toBe('web');
        expect(effectiveUpdateChannel('site', false)).toBe('site');
    });
});

describe('the allow-list', () => {
    it.each([
        'https://play.google.com/store/apps/details?id=com.agrisync.shramsafal',
        'https://play.google.com/store/apps/details?id=com.agrisync.shramsafal&hl=mr',
        'market://details?id=com.agrisync.shramsafal',
    ])('Play: allows %s', url => { expect(isAllowedPlayUrl(url)).toBe(true); });

    it.each([
        'https://play.google.com/store/apps/details?id=com.someone.else',
        'https://play.google.com/store/apps/details?id=com.agrisync.shramsafal.test',
        'http://play.google.com/store/apps/details?id=com.agrisync.shramsafal',
        'https://play.google.com.evil.example/store/apps/details?id=com.agrisync.shramsafal',
        'https://user@play.google.com/store/apps/details?id=com.agrisync.shramsafal',
        'https://play.google.com/store/search?q=com.agrisync.shramsafal',
        'market://details?id=com.someone.else',
        'https://shramsafal.in/apk',
        'not a url',
    ])('Play: refuses %s', url => {
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        expect(isAllowedPlayUrl(url)).toBe(false);
    });

    it.each(['https://shramsafal.in/apk', 'https://www.shramsafal.in/apk', 'https://shramsafal.in/apk?v=1.0.19'])(
        'site: allows %s', url => { expect(isAllowedSiteUrl(url)).toBe(true); });

    it.each([
        'http://shramsafal.in/apk',
        'https://shramsafal.in.evil.example/apk',
        'https://evil.example/shramsafal.in/apk',
        'https://shramsafal.in:8443/apk',
        'https://a:b@shramsafal.in/apk',
        'https://app.shramsafal.in/apk',
        'javascript:alert(1)',
        'file:///sdcard/app.apk',
        '',
    ])('site: refuses %s', url => {
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        expect(isAllowedSiteUrl(url)).toBe(false);
    });
});

describe('where the button goes', () => {
    const release = (playStoreUrl: string | null, apkUrl: string | null) => ({ playStoreUrl, apkUrl });

    it('web reloads the page', () => {
        expect(resolveUpdateTarget('web', release(null, null))).toEqual({ kind: 'reload' });
    });

    it('play and site use the server address when it is allow-listed', () => {
        expect(resolveUpdateTarget('play', release(`${BUILT_IN_PLAY_URL}&hl=mr`, null))).toEqual({ kind: 'open', url: `${BUILT_IN_PLAY_URL}&hl=mr` });
        expect(resolveUpdateTarget('site', release(null, 'https://shramsafal.in/apk?v=2'))).toEqual({ kind: 'open', url: 'https://shramsafal.in/apk?v=2' });
    });

    it('no server address: the built-in place, so the button is never dead (P5)', () => {
        expect(resolveUpdateTarget('play', null)).toEqual({ kind: 'open', url: BUILT_IN_PLAY_URL });
        expect(resolveUpdateTarget('site', release(null, null))).toEqual({ kind: 'open', url: BUILT_IN_APK_URL });
    });

    it('a foreign address from the server is refused, logged, and never opened', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const opener = fakeOpener();
        goToUpdate(release('https://evil.example/app.apk', 'https://evil.example/app.apk'), { channel: 'site', isNative: true, opener });
        goToUpdate(release('https://evil.example/app.apk', 'https://evil.example/app.apk'), { channel: 'play', isNative: true, opener });
        expect(opener.open.mock.calls).toEqual([[BUILT_IN_APK_URL], [BUILT_IN_PLAY_URL]]);
        expect(opener.open.mock.calls.flat().some(u => String(u).includes('evil'))).toBe(false);
        expect(warn.mock.calls.some(([message]) => String(message).includes('Refused'))).toBe(true);
    });

    it('the installed app hands the address to Android (a page navigation Capacitor turns into ACTION_VIEW); a browser opens a new tab', () => {
        const fakeWindow = { open: vi.fn(), location: { assign: vi.fn(), reload: vi.fn() } };
        vi.stubGlobal('window', fakeWindow);
        try {
            deviceOpener(true).open(BUILT_IN_APK_URL);
            expect(fakeWindow.location.assign).toHaveBeenCalledWith(BUILT_IN_APK_URL);
            expect(fakeWindow.open).not.toHaveBeenCalled();
            deviceOpener(false).open(BUILT_IN_PLAY_URL);
            expect(fakeWindow.open).toHaveBeenCalledWith(BUILT_IN_PLAY_URL, '_blank', 'noopener,noreferrer');
            deviceOpener(false).reload();
            expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('each channel opens the right place', () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const server = release(BUILT_IN_PLAY_URL, 'https://shramsafal.in/apk');
        const cases: Array<[Parameters<typeof goToUpdate>[1], string | 'reload']> = [
            [{ channel: 'play', isNative: true }, BUILT_IN_PLAY_URL],
            [{ channel: 'site', isNative: true }, 'https://shramsafal.in/apk'],
            [{ channel: 'web', isNative: false }, 'reload'],
            [{ channel: 'web', isNative: true }, 'https://shramsafal.in/apk'],
        ];
        for (const [options, expected] of cases) {
            const opener = fakeOpener();
            goToUpdate(server, { ...options, opener });
            if (expected === 'reload') {
                expect(opener.reload).toHaveBeenCalledTimes(1);
                expect(opener.open).not.toHaveBeenCalled();
            } else {
                expect(opener.open).toHaveBeenCalledWith(expected);
                expect(opener.reload).not.toHaveBeenCalled();
            }
        }
    });
});
