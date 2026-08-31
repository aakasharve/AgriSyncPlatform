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
 * `apiUrl` lives in `./transport`, not here — see the note above it. Moving it
 * is what lets this module import `agriSyncClient` without closing a cycle.
 */

import { apiUrl } from './transport';
import { getAuthSession } from '../storage/AuthTokenStore';
import { agriSyncClient } from './AgriSyncClient';

export { apiUrl };

/** One attempt. Reads the token at call time so a fresh one is picked up. */
function attempt(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);

    if (!headers.has('Authorization')) {
        const token = getAuthSession()?.accessToken;
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }
    }

    return fetch(apiUrl(path), { ...init, headers });
}

/**
 * `fetch()` against the API, carrying the access token, and surviving an
 * expired one.
 *
 * ON 401 IT REFRESHES ONCE AND RETRIES ONCE.
 *
 * An earlier version deliberately did not, on the reasoning that these are
 * one-shot user actions where a silent retry would be wrong. That reasoning was
 * wrong, because it ignored how short the token's life is. The access token is
 * capped at 15 minutes (`JwtOptions`), and the only things that refresh it are
 * `AuthProvider` on mount and the axios interceptor — there is no timer. So a
 * farmer who opened the app, left it, and came back to confirm an erasure
 * request hit a 401 and got a dead end with no way forward but to guess.
 *
 * There is a second path that needs it just as much: on a cold start
 * `getAuthSession()` returns null until the boot refresh lands, so the first
 * request goes out with no header at all and is refused. Retrying after a
 * refresh is what turns that into a success rather than a mystery.
 *
 * `refreshSession()` is single-flight internally (`AgriSyncClient.refreshPromise`),
 * so several screens hitting 401 at once produce ONE refresh, not a stampede.
 *
 * Exactly one retry. If the second attempt also 401s, that response is returned
 * and the caller shows its error — a loop here would hammer the server with a
 * credential it already knows is dead.
 *
 * A caller may set its own `Authorization`; it is left alone, and such a request
 * is not retried, because the caller owns that credential and we would only be
 * replacing it with a different one behind their back.
 *
 * NOTE ON `body`: a retry re-sends `init` as given. That is safe for the string
 * bodies used here; a streaming body could not be replayed. If one is ever
 * needed, buffer it before calling.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const first = await attempt(path, init);

    if (first.status !== 401) {
        return first;
    }

    // The caller brought its own credential — not ours to second-guess.
    if (new Headers(init.headers).has('Authorization')) {
        return first;
    }

    const outcome = await agriSyncClient.refreshSession();
    if (outcome.kind !== 'refreshed') {
        // 'rejected' means the server judged the credential dead and
        // refreshSession has already cleared it; 'unreachable' means we never
        // got an answer. Neither is improved by asking again with the same
        // token, so the original 401 stands.
        return first;
    }

    return attempt(path, init);
}
