/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane UPD-1 (founder D-53, register F43, doctrine P4 / P11) — does this phone have an older app than
 * the newest one, and should the home card show?
 *
 * WHEN IT ASKS: when the app starts (the first screen that shows the card or the version row starts the
 * checks) and again when the app comes back to the front — but the server is asked AT MOST ONCE A DAY
 * (the phone's calendar day). Offline or any error: nothing is shown, nothing is said to the farmer, the
 * failure is logged, and the LAST ANSWER kept on the phone still drives the card, so an offline start can
 * still remind him.
 *
 * WHAT SHOWS: the card shows only when the server named a well-formed version that is NEWER than this
 * build (`buildInfo.ts` APP_VERSION). "नंतर" hides it until the next day; a version newer than the one he
 * put off shows again at once. Below the server's `minimumVersion` the card cannot be put off and says the
 * old version may stop working soon — it still never blocks the app (P11).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { APP_VERSION } from '../../buildInfo';
import { fetchAppRelease, type AppRelease } from '../../infrastructure/api/appReleaseApi';
import { logger } from '../../infrastructure/observability/Logger';
import {
    readStoredReleaseAnswer, readUpdateLater, writeStoredReleaseAnswer, writeUpdateLater, type StoredUpdateLater,
} from '../../infrastructure/storage/AppUpdateStore';
import { compareVersions, isNewerVersion } from './appVersion';

export interface AppUpdateView {
    /** This build's version — always known, always shown in सेट-अप केंद्र. */
    installedVersion: string;
    /** True only when the newest announced version is newer than this build. */
    updateAvailable: boolean;
    /** The newer version (set only when `updateAvailable`). */
    latestVersion: string | null;
    /** This build is below the server's minimum: the card cannot be put off (never blocks the app). */
    belowMinimum: boolean;
    /** The home card is visible now. */
    showCard: boolean;
    /** The server's last answer (for where "अपडेट करा" goes). */
    release: AppRelease | null;
}

/** The phone's own calendar day, `YYYY-MM-DD` (local time: "the next day" is his next day). */
export function localDay(date: Date): string {
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${m}-${d}`;
}

/** Pure: everything the card and the row need, from the kept facts. */
export function decideAppUpdate(input: {
    installed: string;
    release: AppRelease | null;
    later: StoredUpdateLater | null;
    today: string;
}): AppUpdateView {
    const { installed, release, later, today } = input;
    const latest = release?.latestVersion ?? null;
    const updateAvailable = isNewerVersion(latest, installed);
    const belowMinimum = updateAvailable && compareVersions(installed, release?.minimumVersion) === -1;
    // "नंतर" holds for the day he chose it, and only for that version or an older one.
    const laterVsLatest = later ? compareVersions(latest, later.version) : null;
    const putOffToday = !!later && later.on === today && (laterVsLatest === 0 || laterVsLatest === -1);
    return {
        installedVersion: installed,
        updateAvailable,
        latestVersion: updateAvailable ? latest : null,
        belowMinimum,
        showCard: updateAvailable && (belowMinimum || !putOffToday),
        release,
    };
}

// ── the one shared state for the whole app ──────────────────────────────────────────────────────

export interface AppUpdateDeps {
    installed: string;
    fetchRelease: () => Promise<AppRelease>;
    now: () => Date;
}

const DEFAULT_DEPS: AppUpdateDeps = { installed: APP_VERSION, fetchRelease: () => fetchAppRelease(), now: () => new Date() };
const LOG = { component: 'appUpdate' };

interface Kept { release: AppRelease | null; checkedOn: string | null; later: StoredUpdateLater | null }

let deps: AppUpdateDeps = DEFAULT_DEPS;
let kept: Kept | null = null;
let view: AppUpdateView | null = null;
let started = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): Kept {
    if (!kept) {
        const answer = readStoredReleaseAnswer();
        kept = { release: answer?.release ?? null, checkedOn: answer?.checkedOn ?? null, later: readUpdateLater() };
    }
    return kept;
}

function computeView(): AppUpdateView {
    const k = load();
    return decideAppUpdate({ installed: deps.installed, release: k.release, later: k.later, today: localDay(deps.now()) });
}

/** Recompute the view; tell React only when it really changed. */
function refreshView(): void {
    const next = computeView();
    const same = view && view.showCard === next.showCard && view.updateAvailable === next.updateAvailable
        && view.latestVersion === next.latestVersion && view.belowMinimum === next.belowMinimum && view.release === next.release;
    if (same) return;
    view = next;
    listeners.forEach(l => l());
}

/** A stable snapshot for `useSyncExternalStore` (computed once, then only replaced by `refreshView`). */
function getView(): AppUpdateView {
    if (!view) view = computeView();
    return view;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Ask the server, unless it was already answered today. Never throws; a failure is logged and shows nothing. */
export function checkForAppUpdate(): Promise<void> {
    const today = localDay(deps.now());
    refreshView(); // a new day may bring back a card he put off yesterday
    if (load().checkedOn === today) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = (async () => {
        try {
            const release = await deps.fetchRelease();
            kept = { ...load(), release, checkedOn: today };
            writeStoredReleaseAnswer({ checkedOn: today, release });
            refreshView();
        } catch (error) {
            logger.warn('Could not ask for the newest app version; nothing is shown and the last answer is kept.', {
                ...LOG, error: String(error),
            });
        } finally {
            inFlight = null;
        }
    })();
    return inFlight;
}

const onVisible = (): void => {
    if (document.visibilityState === 'visible') void checkForAppUpdate();
};

/** Once per app start: ask now, and again whenever the app returns to the front (still at most once a day). */
export function startAppUpdateChecks(): void {
    if (started) return;
    started = true;
    void checkForAppUpdate();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
}

/** "नंतर": hide the card until the next day. Refused (and logged) below the minimum version. */
export function putOffAppUpdate(): void {
    const v = getView();
    if (!v.updateAvailable || !v.latestVersion) return;
    if (v.belowMinimum) {
        logger.warn('"Later" is not offered below the minimum version; ignored.', LOG);
        return;
    }
    const later: StoredUpdateLater = { version: v.latestVersion, on: localDay(deps.now()) };
    kept = { ...load(), later };
    writeUpdateLater(later);
    refreshView();
}

/** The card and the सेट-अप केंद्र row read this. Mounting it starts the checks (idempotent). */
export function useAppUpdate(): AppUpdateView {
    const snapshot = useSyncExternalStore(subscribe, getView, getView);
    useEffect(() => { startAppUpdateChecks(); }, []);
    return snapshot;
}

/** Tests only: fresh state, with the given pieces swapped in. */
export function __resetAppUpdateForTests(over: Partial<AppUpdateDeps> = {}): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    deps = { ...DEFAULT_DEPS, ...over };
    kept = null;
    view = null;
    started = false;
    inFlight = null;
    listeners.clear();
}
