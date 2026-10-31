/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane UPD-1 (founder D-53, register F43, doctrine P5 / P11) — WHERE "अपडेट करा" sends the farmer.
 *
 * Build-time setting `VITE_UPDATE_CHANNEL`:
 *   - `play` — the Play listing of com.agrisync.shramsafal (a Play install updates from Play);
 *   - `site` — the APK page, normally https://shramsafal.in/apk, in the phone's browser (a downloaded
 *     APK can never update itself);
 *   - `web`  — the browser build: reload the page (a web deploy already IS the new version). Default.
 *
 * ONLY ALLOW-LISTED PLACES ARE OPENED. The server's `playStoreUrl` is used only when it is the Play
 * listing of THIS app (https://play.google.com/store/apps/details?id=com.agrisync.shramsafal, or
 * market://details?id=com.agrisync.shramsafal); its `apkUrl` only when it is https on shramsafal.in.
 * Anything else is ignored and logged, and the built-in address for that channel is used instead: a
 * wrong or tampered config can never send a farmer to some other download, and the button always goes
 * somewhere real (P5).
 */
import { Capacitor } from '@capacitor/core';
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

/** This build's channel. (`import.meta.env` cannot be stubbed under vitest here, so the parsing above is the tested half.) */
export function readBuildUpdateChannel(): UpdateChannel {
    return parseUpdateChannel((import.meta as ViteEnvShape).env?.VITE_UPDATE_CHANNEL);
}

/**
 * The channel actually used. MY CALL (lane UPD-1): an installed app whose build says `web` (or nothing)
 * goes to the APK page — reloading a native app installs nothing, so `web` there would be a button that
 * does nothing (P5). A browser keeps whatever the build says, so the founder can try every channel in the
 * preview.
 */
export function effectiveUpdateChannel(configured: UpdateChannel, isNative: boolean): UpdateChannel {
    if (isNative && configured === 'web') {
        logger.warn('This installed app was built without VITE_UPDATE_CHANNEL; "Update" opens the APK page.', LOG);
        return 'site';
    }
    return configured;
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

/** "अपडेट करा": this build's channel, on this phone, to the allow-listed place. Each piece can be given (tests). */
export function goToUpdate(
    release: { playStoreUrl: string | null; apkUrl: string | null } | null,
    options: { channel?: UpdateChannel; isNative?: boolean; opener?: UpdateOpener } = {},
): void {
    const isNative = options.isNative ?? Capacitor.isNativePlatform();
    const channel = effectiveUpdateChannel(options.channel ?? readBuildUpdateChannel(), isNative);
    performUpdate(resolveUpdateTarget(channel, release), options.opener ?? deviceOpener(isNative));
}
