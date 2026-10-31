// @vitest-environment jsdom
/**
 * Lane UPD-1 — when the phone asks, what it keeps, and when the card shows.
 * Offline / error: nothing shown, logged, never thrown. At most one question a day. The last answer is
 * kept so an offline start can still remind him. "नंतर" until the next day; a newer version re-shows;
 * below the minimum the card cannot be put off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRelease } from '../../../infrastructure/api/appReleaseApi';
import { logger } from '../../../infrastructure/observability/Logger';
import { readStoredReleaseAnswer, readUpdateLater } from '../../../infrastructure/storage/AppUpdateStore';
import {
    __resetAppUpdateForTests, checkForAppUpdate, decideAppUpdate, localDay, putOffAppUpdate, startAppUpdateChecks,
    type AppUpdateDeps,
} from '../appUpdateState';

const rel = (latestVersion: string | null, minimumVersion: string | null = null): AppRelease =>
    ({ latestVersion, minimumVersion, playStoreUrl: null, apkUrl: 'https://shramsafal.in/apk' });

const DAY1 = new Date(2026, 10, 1, 9, 0, 0);
const DAY1_EVENING = new Date(2026, 10, 1, 21, 0, 0);
const DAY2 = new Date(2026, 10, 2, 7, 0, 0);

let clock = DAY1;
const setup = (over: Partial<AppUpdateDeps> = {}) => {
    const fetchRelease = vi.fn<() => Promise<AppRelease>>().mockResolvedValue(rel('1.0.18'));
    __resetAppUpdateForTests({ installed: '1.0.17', fetchRelease, now: () => clock, ...over });
    return { fetchRelease: (over.fetchRelease ?? fetchRelease) as ReturnType<typeof vi.fn> };
};
/** What a screen would read right now (a fresh hook mount reads the same snapshot). */
const viewNow = () => {
    const today = localDay(clock);
    return decideAppUpdate({ installed: '1.0.17', release: readStoredReleaseAnswer()?.release ?? null, later: readUpdateLater(), today });
};

beforeEach(() => { localStorage.clear(); clock = DAY1; });
afterEach(() => { vi.restoreAllMocks(); __resetAppUpdateForTests(); });

describe('decideAppUpdate (pure)', () => {
    const decide = (release: AppRelease | null, later: { version: string; on: string } | null = null, today = '2026-11-01') =>
        decideAppUpdate({ installed: '1.0.17', release, later, today });

    it('nothing announced, the same, older or malformed: no card', () => {
        for (const r of [null, rel(null), rel('1.0.17'), rel('1.0.9'), rel('1.0.x'), rel('')]) {
            const v = decide(r);
            expect(v.updateAvailable).toBe(false);
            expect(v.showCard).toBe(false);
            expect(v.latestVersion).toBeNull();
            expect(v.installedVersion).toBe('1.0.17');
        }
    });

    it('a newer version shows the card', () => {
        expect(decide(rel('1.0.18'))).toMatchObject({ updateAvailable: true, latestVersion: '1.0.18', showCard: true, belowMinimum: false });
    });

    it('"नंतर" holds for that day only, and only for that version (or older)', () => {
        expect(decide(rel('1.0.18'), { version: '1.0.18', on: '2026-11-01' }).showCard).toBe(false);
        expect(decide(rel('1.0.18'), { version: '1.0.18', on: '2026-10-31' }).showCard).toBe(true);
        expect(decide(rel('1.0.19'), { version: '1.0.18', on: '2026-11-01' }).showCard).toBe(true);
        expect(decide(rel('1.0.18'), { version: 'garbled', on: '2026-11-01' }).showCard).toBe(true);
    });

    it('below the minimum the card shows even after "नंतर"; a malformed minimum is ignored', () => {
        const v = decide(rel('1.0.19', '1.0.18'), { version: '1.0.19', on: '2026-11-01' });
        expect(v).toMatchObject({ belowMinimum: true, showCard: true });
        expect(decide(rel('1.0.19', '1.0.17')).belowMinimum).toBe(false);
        expect(decide(rel('1.0.19', 'x')).belowMinimum).toBe(false);
        // a minimum with nothing newer to go to says nothing
        expect(decide(rel('1.0.17', '1.0.18'))).toMatchObject({ belowMinimum: false, showCard: false });
    });
});

describe('asking the server', () => {
    it('asks on start, keeps the answer on the phone', async () => {
        const { fetchRelease } = setup();
        startAppUpdateChecks();
        await checkForAppUpdate();
        expect(fetchRelease).toHaveBeenCalledTimes(1);
        expect(readStoredReleaseAnswer()).toEqual({ checkedOn: '2026-11-01', release: rel('1.0.18') });
        expect(viewNow().showCard).toBe(true);
    });

    it('asks at most once a day; the next day it asks again', async () => {
        const { fetchRelease } = setup();
        await checkForAppUpdate();
        clock = DAY1_EVENING;
        await checkForAppUpdate();
        await checkForAppUpdate();
        expect(fetchRelease).toHaveBeenCalledTimes(1);
        clock = DAY2;
        await checkForAppUpdate();
        expect(fetchRelease).toHaveBeenCalledTimes(2);
    });

    it('two screens asking at once share one question', async () => {
        const { fetchRelease } = setup();
        await Promise.all([checkForAppUpdate(), checkForAppUpdate()]);
        expect(fetchRelease).toHaveBeenCalledTimes(1);
    });

    it('offline / server error: nothing shown, nothing thrown, logged; it tries again next start', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const fetchRelease = vi.fn<() => Promise<AppRelease>>().mockRejectedValue(new TypeError('Failed to fetch'));
        setup({ fetchRelease });
        await expect(checkForAppUpdate()).resolves.toBeUndefined();
        expect(viewNow().showCard).toBe(false);
        expect(readStoredReleaseAnswer()).toBeNull();
        expect(warn).toHaveBeenCalled();
        await checkForAppUpdate();
        expect(fetchRelease).toHaveBeenCalledTimes(2); // a failed question does not use up the day
    });

    it('an offline start still reminds him from the last answer kept on the phone', async () => {
        setup();
        await checkForAppUpdate(); // day 1, online: 1.0.18 announced
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        clock = DAY2;
        const offline = vi.fn<() => Promise<AppRelease>>().mockRejectedValue(new TypeError('Failed to fetch'));
        setup({ fetchRelease: offline }); // a fresh app start, offline
        await checkForAppUpdate();
        expect(offline).toHaveBeenCalledTimes(1);
        expect(viewNow()).toMatchObject({ showCard: true, latestVersion: '1.0.18' });
    });

    it('a server that announces nothing clears an earlier announcement', async () => {
        const fetchRelease = vi.fn<() => Promise<AppRelease>>().mockResolvedValueOnce(rel('1.0.18')).mockResolvedValueOnce(rel(null));
        setup({ fetchRelease });
        await checkForAppUpdate();
        clock = DAY2;
        await checkForAppUpdate();
        expect(viewNow().showCard).toBe(false);
    });
});

describe('"नंतर" (Later)', () => {
    it('hides the card until the next day', async () => {
        setup();
        await checkForAppUpdate();
        putOffAppUpdate();
        expect(readUpdateLater()).toEqual({ version: '1.0.18', on: '2026-11-01' });
        expect(viewNow().showCard).toBe(false);
        clock = DAY2;
        expect(viewNow().showCard).toBe(true);
    });

    it('is refused below the minimum version (logged), and the card stays', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        setup({ fetchRelease: vi.fn<() => Promise<AppRelease>>().mockResolvedValue(rel('1.0.19', '1.0.18')) });
        await checkForAppUpdate();
        putOffAppUpdate();
        expect(readUpdateLater()).toBeNull();
        expect(warn).toHaveBeenCalled();
    });
});
