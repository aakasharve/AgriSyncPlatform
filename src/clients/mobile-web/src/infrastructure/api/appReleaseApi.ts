/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane UPD-1 (founder D-53, register F43) — asks the server which app version is the newest.
 *
 * `GET /version/app` is anonymous (no token, no farm) and answers from server configuration only:
 * `{ latestVersion, minimumVersion, playStoreUrl, apkUrl }`, every field may be null. A null
 * `latestVersion` means "nothing announced" and the phone shows nothing (doctrine P4).
 *
 * Throws on a network failure, a non-2xx answer or a body of the wrong shape; the caller logs it and
 * shows the farmer nothing (it is never an error on his screen).
 */
import { z } from 'zod';
import { apiUrl } from './transport';

export const APP_RELEASE_PATH = '/version/app';

/** Give up after this long: a slow network must not hold a request open for the whole visit. */
const TIMEOUT_MS = 10_000;

export interface AppRelease {
    latestVersion: string | null;
    minimumVersion: string | null;
    playStoreUrl: string | null;
    apkUrl: string | null;
}

const AppReleaseSchema = z.object({
    latestVersion: z.string().nullish(),
    minimumVersion: z.string().nullish(),
    playStoreUrl: z.string().nullish(),
    apkUrl: z.string().nullish(),
});

/** The server's body as an `AppRelease`; throws when it is not that shape. */
export function parseAppRelease(body: unknown): AppRelease {
    const parsed = AppReleaseSchema.parse(body);
    return {
        latestVersion: parsed.latestVersion ?? null,
        minimumVersion: parsed.minimumVersion ?? null,
        playStoreUrl: parsed.playStoreUrl ?? null,
        apkUrl: parsed.apkUrl ?? null,
    };
}

export async function fetchAppRelease(fetchImpl: typeof fetch = globalThis.fetch): Promise<AppRelease> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetchImpl(apiUrl(APP_RELEASE_PATH), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`GET ${APP_RELEASE_PATH} answered HTTP ${response.status}`);
        }
        return parseAppRelease(await response.json());
    } finally {
        clearTimeout(timer);
    }
}
