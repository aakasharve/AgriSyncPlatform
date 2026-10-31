/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane UPD-1 (founder D-53, register F43, doctrine P5 / P11) — WHERE "अपडेट करा" sends the farmer.
 *
 * The places (channels):
 *   - `play` — the Play listing of com.agrisync.shramsafal (a Play install updates from Play);
 *   - `site` — the APK page, normally https://shramsafal.in/apk, in the phone's browser (a downloaded
 *     APK can never update itself);
 *   - `web`  — reload the page (a web deploy already IS the new version).
 *
 * WHO DECIDES (fix pass, orchestrator 2026-10-31). The release builds ONE web bundle for the web, the
 * site APK and the Play bundle, so a build-time setting cannot tell the two installed apps apart:
 *   - an INSTALLED app asks Android which app installed it (native plugin `InstallSource`):
 *     `com.android.vending` -> `play`; anything else or nothing -> `site`; the plugin missing or failing
 *     -> `site`, logged (never an error to the farmer). The build-time setting plays no part here;
 *   - a BROWSER follows the build-time setting `VITE_UPDATE_CHANNEL` (default `web`).
 *
 * ONLY ALLOW-LISTED PLACES ARE OPENED. The server's `playStoreUrl` is used only when it is the Play
 * listing of THIS app (https://play.google.com/store/apps/details?id=com.agrisync.shramsafal, or
 * market://details?id=com.agrisync.shramsafal); its `apkUrl` only when it is https on shramsafal.in.
 * Anything else is ignored and logged, and the built-in address for that channel is used instead: a
 * wrong or tampered config can never send a farmer to some other download, and the button always goes
 * somewhere real (P5).
 */
import { Capacitor } from '@capacitor/core';
import { PLAY_STORE_INSTALLER, readInstaller } from '../../infrastructure/device/installSource';
import { logger } from '../../infrastructure/observability/Logger';

export type UpdateChannel = 'play' | 'site' | 'web';

export const ANDROID_APP_ID = 'com.agrisync.shramsafal';
export const BUILT_IN_PLAY_URL = `https://play.google.com/store/apps/details?id=${ANDROID_APP_ID}`;
export const BUILT_IN_APK_URL = 'https://shramsafal.in/apk';

const SITE_HOSTS = new Set(['shramsafal.in', 'www.shramsafal.in']);
const LOG = { component: 'appUpdate' };

/** The setting's value; empty = `web`; anything unknown = `web` and logged. */
export function parseUpdateChannel(raw: unknown): UpdateChannel {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (value === 'play' || value === 'site' || value === 'web') return value;
    if (value !== '') logger.warn(`VITE_UPDATE_CHANNEL "${value}" is not play, site or web; using web.`, LOG);
    return 'web';
}

interface ViteEnvShape { env?: Record<string, unknown> }

/** This build's channel, for a BROWSER. (`import.meta.env` cannot be stubbed under vitest here, so the parsing above is the tested half.) */
export function readBuildUpdateChannel(): UpdateChannel {
    return parseUpdateChannel((import.meta as ViteEnvShape).env?.VITE_UPDATE_CHANNEL);
}

/** Which app installed this one: the package name, or null when none is recorded. Throws when it cannot be read. */
export type InstallerLookup = () => Promise<string | null>;

/**
 * An INSTALLED app's channel, from who installed it: Google Play -> `play`; anything else (a browser, a
 * file manager, adb, nothing recorded) -> `site`. The lookup missing or failing -> `site`, logged: the APK
 * page is the safe answer for an app that cannot say where it came from (a reload would install nothing).
 */
export async function installedAppChannel(lookup: InstallerLookup): Promise<'play' | 'site'> {
    try {
        const installer = await lookup();
        return installer === PLAY_STORE_INSTALLER ? 'play' : 'site';
    } catch (error) {
        logger.warn('Could not read which app installed this one; "Update" opens the APK page.', { ...LOG, error: String(error) });
        return 'site';
    }
}

function parseUrl(value: string): URL | null {
    try {
        return new URL(value);
    } catch (error) {
        logger.warn('An update address from the server is not a URL; ignored.', { ...LOG, value, error: String(error) });
        return null;
    }
}

/** The Play listing of THIS app, and nothing else. */
export function isAllowedPlayUrl(value: string): boolean {
    const url = parseUrl(value);
    if (!url || url.username || url.password) return false;
    if (url.protocol === 'https:') {
        return url.hostname === 'play.google.com' && url.port === '' && url.pathname === '/store/apps/details'
            && url.searchParams.get('id') === ANDROID_APP_ID;
    }
    if (url.protocol === 'market:') {
        return url.hostname === 'details' && url.searchParams.get('id') === ANDROID_APP_ID;
    }
    return false;
}

/** An https page on shramsafal.in, and nothing else. */
export function isAllowedSiteUrl(value: string): boolean {
    const url = parseUrl(value);
    return !!url && url.protocol === 'https:' && SITE_HOSTS.has(url.hostname) && url.port === ''
        && !url.username && !url.password;
}

export type UpdateTarget = { kind: 'open'; url: string } | { kind: 'reload' };

/** Where the button goes for this channel, using the server's address only when it is allow-listed. */
export function resolveUpdateTarget(
    channel: UpdateChannel,
    release: { playStoreUrl: string | null; apkUrl: string | null } | null,
): UpdateTarget {
    if (channel === 'web') return { kind: 'reload' };
    const offered = channel === 'play' ? release?.playStoreUrl : release?.apkUrl;
    const allowed = channel === 'play' ? isAllowedPlayUrl : isAllowedSiteUrl;
    const builtIn = channel === 'play' ? BUILT_IN_PLAY_URL : BUILT_IN_APK_URL;
    if (offered) {
        if (allowed(offered)) return { kind: 'open', url: offered.trim() };
        logger.warn('Refused an update address from the server that is not on the allow-list; using the built-in one.', {
            ...LOG, channel, refused: offered,
        });
    }
    return { kind: 'open', url: builtIn };
}

export interface UpdateOpener {
    /** Opens the address outside the app (the phone's browser, or the Play app for a Play link). */
    open: (url: string) => void;
    reload: () => void;
}

/**
 * Inside the installed app the page navigates to the address: Capacitor stops any navigation away from
 * the app's own origin (`BridgeWebViewClient` -> `Bridge.launchIntent`) and hands it to Android as
 * ACTION_VIEW, which opens the phone's browser, or the Play app for a Play / market:// link; the app stays
 * where it was. In a browser the address opens in a new tab, so the app tab is not lost.
 */
export function deviceOpener(isNative: boolean): UpdateOpener {
    return {
        open: (url) => {
            if (isNative) window.location.assign(url);
            else window.open(url, '_blank', 'noopener,noreferrer');
        },
        reload: () => { window.location.reload(); },
    };
}

export function performUpdate(target: UpdateTarget, opener: UpdateOpener): void {
    logger.info('Farmer tapped Update.', { ...LOG, target: target.kind === 'open' ? target.url : 'reload' });
    if (target.kind === 'reload') opener.reload();
    else opener.open(target.url);
}

/**
 * "अपडेट करा" to the allow-listed place: an installed app by who installed it, a browser by the build's
 * setting. Each piece can be given (tests). Never rejects: a failure is logged, never shown.
 * A browser opens synchronously, inside the tap, so no pop-up blocker can stop the new tab.
 */
export function goToUpdate(
    release: { playStoreUrl: string | null; apkUrl: string | null } | null,
    options: { channel?: UpdateChannel; isNative?: boolean; installer?: InstallerLookup; opener?: UpdateOpener } = {},
): Promise<void> {
    const isNative = options.isNative ?? Capacitor.isNativePlatform();
    const opener = options.opener ?? deviceOpener(isNative);
    const go = (channel: UpdateChannel) => performUpdate(resolveUpdateTarget(channel, release), opener);
    try {
        if (!isNative) {
            go(options.channel ?? readBuildUpdateChannel());
            return Promise.resolve();
        }
        return installedAppChannel(options.installer ?? (() => readInstaller()))
            .then(go)
            .catch((error: unknown) => { logger.error('Could not open the update place.', error, LOG); });
    } catch (error) {
        logger.error('Could not open the update place.', error, LOG);
        return Promise.resolve();
    }
}
