/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF2 fix pass, review B004) — what happens to his words when
 * there is no internet, and the two plain outcomes the parse reports.
 *
 * Offline, a recording is kept on the phone as a pending AI job and later becomes a NEW log draft. That is right for a
 * day's work and WRONG for words that are a "बदला" (a change to a saved entry): kept that way they would come back as a
 * new entry. So the app can close the offline queue for the moment (`setOfflineVoiceQueueGate`; the ONE mic closes it
 * while a correction is being spoken), and the parse then keeps nothing and says so.
 *
 * The parse returns these two sentences as STABLE CODES (English, as the infrastructure has no language); the screen
 * shows them in the person's language (`recorderWords.readableError`).
 */
import { isAfterFarmToday } from '../../core/domain/services/farmDay';
import { logger } from '../observability/Logger';

/** His words are kept on the phone and will be understood when he is back online. */
export const OFFLINE_SAVED_MESSAGE = 'Saved locally. Will process when connected.';
/** Nothing was kept: what he said needs the internet (a change to a saved entry). */
export const OFFLINE_NOT_KEPT_MESSAGE = 'Not kept offline: this needs the internet.';
/**
 * Lane OF fix pass 1 (H1, L4) — nothing was kept: the day he chose could not be read, or it is after today. Refused
 * plainly, never quietly kept on another day.
 */
export const OFFLINE_DAY_REFUSED_MESSAGE = 'Not kept offline: the chosen day could not be used.';

let mayQueue: () => boolean = () => true;


/** The app says whether words spoken now may be kept offline (a correction may not). */
export function setOfflineVoiceQueueGate(gate: () => boolean): void {
    mayQueue = gate;
}

/** May words spoken now be kept on the phone for later? (A failing gate never blocks a day's work.) */
export function offlineVoiceQueueAllowed(): boolean {
    try {
        return mayQueue();
    } catch {
        return true;
    }
}

/**
 * Lane OF (founder D-60) — the past day (`yyyy-MM-dd`) the words spoken NOW are for, when he chose one before speaking.
 * Kept on the offline job, so the recording is saved on that day once it is understood. Undefined = today.
 */
let dayNow: () => string | undefined = () => undefined;

export function setOfflineVoiceDayProvider(provider: () => string | undefined): void {
    dayNow = provider;
}

/**
 * The chosen day for words spoken now: `{ ok: true }` with no day (today), `{ ok: true, day }` for a past day, or
 * `{ ok: false }` — the day could not be read, or it is after the farm's today (lane OF fix pass 1, H1 / L4). A refused
 * day is never quietly turned into the day he spoke: the caller keeps nothing and says so.
 */
export type OfflineVoiceDay = { ok: true; day?: string } | { ok: false; reason: 'unreadable' | 'afterToday' };

export function offlineVoiceDay(): OfflineVoiceDay {
    let day: string | undefined;
    try {
        day = dayNow();
    } catch (error) {
        logger.warn('offline voice: the chosen day could not be read — nothing kept', { error: String(error) });
        return { ok: false, reason: 'unreadable' };
    }
    if (day === undefined) return { ok: true };
    if (isAfterFarmToday(day)) {
        logger.warn('offline voice: the chosen day is after today (or not a day) — nothing kept', { day });
        return { ok: false, reason: 'afterToday' };
    }
    return { ok: true, day };
}
