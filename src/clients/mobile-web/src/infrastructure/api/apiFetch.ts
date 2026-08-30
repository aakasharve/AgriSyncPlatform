/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The `fetch()` equivalent of what `AgriSyncClient` does for axios.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every axios request is built on `resolveApiBaseUrl()` and gets an
 * `Authorization` header from an interceptor. A handful of screens call bare
 * `fetch()` instead, and inherited neither. They passed an app-relative path —
 * `/shramsafal/me/erasure/request` — straight to the browser.
 *
 * That works in `npm run dev`, because `resolveApiBaseUrl()` returns `''` and
 * Vite proxies the path. It cannot work in the APK: Capacitor serves the app
 * from `https://localhost` with no `server.url`, and the release build bakes in
 * `VITE_AGRISYNC_API_URL=https://api.shramsafal.in`. So axios reached the API
 * while those screens quietly asked the WebView about itself.
 *
 * Working in dev and only in dev is what let it ship.
 *
 * Use `apiFetch` for anything the user is waiting on. Use `apiUrl` only when you
 * deliberately want no credentials — currently just error telemetry, which must
 * never depend on being logged in.
 */

import { resolveApiBaseUrl } from './transport';
import { getAuthSession } from '../storage/AuthTokenStore';

/**
 * Absolute URL for an API path.
 *
 * Returns the path unchanged when no API host is configured, which is the local
 * dev case — keeping the Vite proxy working rather than breaking it in order to
 * fix the APK.
 */
export function apiUrl(path: string): string {
    const base = resolveApiBaseUrl();
    const suffix = path.startsWith('/') ? path : `/${path}`;
    if (!base) {
        return suffix;
    }
    return `${base.replace(/\/+$/, '')}${suffix}`;
}

/**
 * `fetch()` against the API, carrying the access token.
 *
 * The token is read at call time rather than captured, so a refresh that lands
 * mid-session is picked up. When there is no session the header is omitted
 * entirely — sending `Bearer undefined` turns a clean 401 into a parse error on
 * the server and a much worse log line.
 *
 * A caller may set its own `Authorization` and it is left alone.
 *
 * NOTE: unlike axios, this does NOT retry on 401. Callers here are one-shot user
 * actions where a silent retry would be wrong; if that changes, route them
 * through `AgriSyncClient` instead of widening this.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);

    if (!headers.has('Authorization')) {
        const token = getAuthSession()?.accessToken;
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }
    }

    return fetch(apiUrl(path), { ...init, headers });
}
