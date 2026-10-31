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

/** His words are kept on the phone and will be understood when he is back online. */
export const OFFLINE_SAVED_MESSAGE = 'Saved locally. Will process when connected.';
/** Nothing was kept: what he said needs the internet (a change to a saved entry). */
export const OFFLINE_NOT_KEPT_MESSAGE = 'Not kept offline: this needs the internet.';

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

/** The chosen day for words spoken now, or undefined (a failing provider never blocks keeping his words). */
export function offlineVoiceDay(): string | undefined {
    try {
        const day = dayNow();
        return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
    } catch {
        return undefined;
    }
}
