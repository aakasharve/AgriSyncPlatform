/**
 * Public web origin for user-shareable absolute URLs (farm invite QR/link).
 *
 * Inside the Capacitor APK window.location.origin is https://localhost, so a
 * link built from it is unusable by anyone else. On native we therefore use
 * the production web origin that serves the join landing page. The same
 * bundle runs on web and APK: this is a config constant, not a build fork.
 * Override at build time with VITE_PUBLIC_WEB_ORIGIN (e.g. for staging).
 */
import { Capacitor } from '@capacitor/core';

export const DEFAULT_PUBLIC_WEB_ORIGIN = 'https://app.shramsafal.in';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Returns a bare origin for a usable public http(s) URL, else null. */
export function normalizeOrigin(raw: string | undefined | null): string | null {
    if (!raw || !raw.trim()) return null;
    try {
        const u = new URL(raw.trim());
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        if (LOCAL_HOSTS.has(u.hostname)) return null;
        return u.origin;
    } catch {
        return null;
    }
}

export function resolveShareOrigin(args: {
    isNative: boolean;
    windowOrigin: string;
    configured: string | undefined;
}): string {
    if (!args.isNative) return args.windowOrigin;
    return normalizeOrigin(args.configured) ?? DEFAULT_PUBLIC_WEB_ORIGIN;
}

export function getShareOrigin(): string {
    const configured = (import.meta as { env?: { VITE_PUBLIC_WEB_ORIGIN?: string } }).env?.VITE_PUBLIC_WEB_ORIGIN;
    return resolveShareOrigin({
        isNative: Capacitor.isNativePlatform(),
        windowOrigin: typeof window !== 'undefined' ? window.location.origin : DEFAULT_PUBLIC_WEB_ORIGIN,
        configured,
    });
}
