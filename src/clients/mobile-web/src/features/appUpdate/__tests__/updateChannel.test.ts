/**
 * Lane UPD-1 — where "अपडेट करा" goes: each channel to its place, and ONLY allow-listed places.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readInstaller } from '../../../infrastructure/device/installSource';
import { logger } from '../../../infrastructure/observability/Logger';
import {
    BUILT_IN_APK_URL, BUILT_IN_PLAY_URL, deviceOpener, goToUpdate, installedAppChannel, isAllowedPlayUrl, isAllowedSiteUrl,
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

});

describe('an installed app: who installed it decides (fix pass — one bundle for web, APK and Play)', () => {
    it.each<[string | null, 'play' | 'site']>([
        ['com.android.vending', 'play'],
        [null, 'site'],                                      // nothing recorded (adb, some file managers)
        ['com.android.chrome', 'site'],                      // downloaded in the browser
        ['com.google.android.packageinstaller', 'site'],     // opened from a file manager
        ['com.android.shell', 'site'],                       // adb
        ['com.android.vending.evil', 'site'],                // only the exact Play package counts
        ['', 'site'],
    ])('installer %j -> %s', async (installer, expected) => {
        await expect(installedAppChannel(() => Promise.resolve(installer))).resolves.toBe(expected);
    });

    it('the plugin failing -> the APK page, logged, never thrown', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        await expect(installedAppChannel(() => Promise.reject(new Error('NameNotFoundException')))).resolves.toBe('site');
        await expect(installedAppChannel(() => { throw new Error('sync throw'); })).resolves.toBe('site');
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('the plugin missing (an app built before it, or a browser) -> the APK page, logged', async () => {
        // The REAL registered proxy, outside a native shell: Capacitor answers "not implemented".
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        await expect(installedAppChannel(() => readInstaller())).resolves.toBe('site');
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('the build-time setting plays no part for an installed app', async () => {
        vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const server = { playStoreUrl: BUILT_IN_PLAY_URL, apkUrl: 'https://shramsafal.in/apk' };
        for (const channel of ['web', 'play', 'site'] as const) {
            const fromSite = fakeOpener();
            await goToUpdate(server, { isNative: true, channel, installer: () => Promise.resolve(null), opener: fromSite });
            expect(fromSite.open).toHaveBeenCalledWith('https://shramsafal.in/apk');
            const fromPlay = fakeOpener();
            await goToUpdate(server, { isNative: true, channel, installer: () => Promise.resolve('com.android.vending'), opener: fromPlay });
            expect(fromPlay.open).toHaveBeenCalledWith(BUILT_IN_PLAY_URL);
            expect(fromSite.reload).not.toHaveBeenCalled();
            expect(fromPlay.reload).not.toHaveBeenCalled();
        }
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

    it('a foreign address from the server is refused, logged, and never opened (installed app and browser alike)', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const evil = release('https://evil.example/app.apk', 'https://evil.example/app.apk');
        const opener = fakeOpener();
        await goToUpdate(evil, { isNative: true, installer: () => Promise.resolve(null), opener });
        await goToUpdate(evil, { isNative: true, installer: () => Promise.resolve('com.android.vending'), opener });
        await goToUpdate(evil, { isNative: false, channel: 'site', opener });
        await goToUpdate(evil, { isNative: false, channel: 'play', opener });
        expect(opener.open.mock.calls).toEqual([[BUILT_IN_APK_URL], [BUILT_IN_PLAY_URL], [BUILT_IN_APK_URL], [BUILT_IN_PLAY_URL]]);
        expect(opener.open.mock.calls.flat().some(u => String(u).includes('evil'))).toBe(false);
        expect(warn.mock.calls.filter(([message]) => String(message).includes('Refused'))).toHaveLength(4);
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

    it('each place opens the right address', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const server = release(BUILT_IN_PLAY_URL, 'https://shramsafal.in/apk');
        const cases: Array<[Parameters<typeof goToUpdate>[1], string | 'reload']> = [
            [{ isNative: true, installer: () => Promise.resolve('com.android.vending') }, BUILT_IN_PLAY_URL],
            [{ isNative: true, installer: () => Promise.resolve('com.android.chrome') }, 'https://shramsafal.in/apk'],
            [{ isNative: true, installer: () => Promise.reject(new Error('plugin threw')) }, 'https://shramsafal.in/apk'],
            [{ isNative: false, channel: 'play' }, BUILT_IN_PLAY_URL],
            [{ isNative: false, channel: 'site' }, 'https://shramsafal.in/apk'],
            [{ isNative: false, channel: 'web' }, 'reload'],
        ];
        for (const [options, expected] of cases) {
            const opener = fakeOpener();
            await goToUpdate(server, { ...options, opener });
            if (expected === 'reload') {
                expect(opener.reload).toHaveBeenCalledTimes(1);
                expect(opener.open).not.toHaveBeenCalled();
            } else {
                expect(opener.open).toHaveBeenCalledWith(expected);
                expect(opener.reload).not.toHaveBeenCalled();
            }
        }
    });

    it('a browser opens inside the tap (synchronously), so no pop-up blocker stops the new tab', () => {
        vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const opener = fakeOpener();
        void goToUpdate(release(null, null), { isNative: false, channel: 'site', opener });
        expect(opener.open).toHaveBeenCalledWith(BUILT_IN_APK_URL); // before any await
    });

    it('opening failing is logged, never thrown at the farmer', async () => {
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const broken = { open: () => { throw new Error('no browser'); }, reload: () => undefined };
        await expect(goToUpdate(release(null, null), { isNative: true, installer: () => Promise.resolve(null), opener: broken })).resolves.toBeUndefined();
        await expect(goToUpdate(release(null, null), { isNative: false, channel: 'site', opener: broken })).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledTimes(2);
    });
});
