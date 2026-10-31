/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane UPD-1 (founder D-53) — two facts that belong to THIS PHONE, not to a farmer:
 *   - the server's last answer about the newest app version, and the day it was asked. Kept so an
 *     offline start can still remind him, and so the server is asked at most once a day;
 *   - "नंतर" (Later): which announced version he put off, and on which day (hidden until the next day).
 *
 * Phone-level like `FirstRunDeviceStore` (literal keys, never namespaced per farmer): the installed app
 * is the phone's, whoever is signed in. No personal data. Every read and write is fenced and logged: a
 * phone with blocked storage simply asks again and shows the card again, which is harmless.
 */
import { logger } from '../observability/Logger';

const RELEASE_KEY = 'shramsafal_app_release_v1';
const LATER_KEY = 'shramsafal_app_update_later_v1';

/** The server's answer (mirrors `infrastructure/api/appReleaseApi.ts`; kept local so storage imports no API module). */
export interface StoredRelease {
    latestVersion: string | null;
    minimumVersion: string | null;
    playStoreUrl: string | null;
    apkUrl: string | null;
}

export interface StoredReleaseAnswer {
    /** The phone's own calendar day the answer arrived, `YYYY-MM-DD`. */
    checkedOn: string;
    release: StoredRelease;
}

export interface StoredUpdateLater {
    /** The announced version he put off. */
    version: string;
    /** The day he tapped "नंतर", `YYYY-MM-DD`. */
    on: string;
}

const LOG = { component: 'AppUpdateStore' };

const store = (): Storage | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch (error) {
        logger.warn('Phone storage is not available; the update answer is not kept.', { ...LOG, error: String(error) });
        return null;
    }
};

const isTextOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

function readJson(key: string): unknown {
    try {
        const raw = store()?.getItem(key);
        return raw ? (JSON.parse(raw) as unknown) : null;
    } catch (error) {
        logger.warn('Could not read a kept update fact; treating it as absent.', { ...LOG, key, error: String(error) });
        return null;
    }
}

function writeJson(key: string, value: unknown): void {
    try {
        store()?.setItem(key, JSON.stringify(value));
    } catch (error) {
        logger.warn('Could not keep an update fact on the phone; it holds for this visit only.', { ...LOG, key, error: String(error) });
    }
}

export function readStoredReleaseAnswer(): StoredReleaseAnswer | null {
    const v = readJson(RELEASE_KEY) as { checkedOn?: unknown; release?: Record<string, unknown> } | null;
    const r = v?.release;
    if (!v || typeof v.checkedOn !== 'string' || !r || typeof r !== 'object'
        || !isTextOrNull(r.latestVersion) || !isTextOrNull(r.minimumVersion)
        || !isTextOrNull(r.playStoreUrl) || !isTextOrNull(r.apkUrl)) {
        if (v) logger.warn('A kept update answer had the wrong shape; ignored.', LOG);
        return null;
    }
    return {
        checkedOn: v.checkedOn,
        release: { latestVersion: r.latestVersion, minimumVersion: r.minimumVersion, playStoreUrl: r.playStoreUrl, apkUrl: r.apkUrl },
    };
}

export function writeStoredReleaseAnswer(answer: StoredReleaseAnswer): void {
    writeJson(RELEASE_KEY, answer);
}

export function readUpdateLater(): StoredUpdateLater | null {
    const v = readJson(LATER_KEY) as { version?: unknown; on?: unknown } | null;
    if (!v || typeof v.version !== 'string' || typeof v.on !== 'string') {
        if (v) logger.warn('A kept "later" choice had the wrong shape; ignored.', LOG);
        return null;
    }
    return { version: v.version, on: v.on };
}

export function writeUpdateLater(later: StoredUpdateLater): void {
    writeJson(LATER_KEY, later);
}
