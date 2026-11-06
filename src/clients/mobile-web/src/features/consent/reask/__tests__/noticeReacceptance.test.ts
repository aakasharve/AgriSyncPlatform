// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-13, D-36)
//
// Ask ONCE, on the phone, when the notice changes materially — never lose the answer, never
// claim an answer that exists nowhere, and never hold the farmer on a stalled network.
import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { setActiveDatabaseName } from '../../../../infrastructure/storage/activeDatabaseName';
import { perUserDatabaseName, UNIDENTIFIED_DATABASE_NAME } from '../../../../infrastructure/storage/userDatabaseName';
import { linkConsentGateToUser } from '../../../../infrastructure/consent/ConsentGateLinkClient';
import { PENDING_CONSENT_GATE_LINK_PREF_KEY } from '../../../../infrastructure/storage/ConsentGateLinkStore';
import { ACCEPTED_NOTICE_PREF_KEY, hasCoreConsent } from '../../separation/coreConsentGate';
import { NOTICE_VERSION, canonicalNoticeText } from '../../gate/consentNotice';
import {
    PENDING_REACCEPTANCE_PREF_KEY,
    __resetNoticeReacceptanceForTests,
    flushNoticeReacceptance,
    needsNoticeReacceptance,
    SERVER_CHECK_LIMIT_MS,
    recordNoticeReacceptance,
} from '../noticeReacceptance';

vi.mock('../../../../infrastructure/consent/ConsentGateLinkClient', () => ({
    linkConsentGateToUser: vi.fn(),
}));

const linkMock = vi.mocked(linkConsentGateToUser);
const twoIds = { termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1', alreadyLinked: false };
const FARMER_DB = perUserDatabaseName('reask');
const OLD_NOTICE = 'notice-2026-10-25.1';

const setOnline = (value: boolean) => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
};

const pref = async (key: string) => (await getDatabase().uiPrefs.get(key))?.value;
const stalled = () => new Promise<never>(() => { /* never settles */ });

/** Let background work (the flush that follows a queue write) run. */
const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

async function wipe(): Promise<void> {
    try { await resetDatabase(); } catch { /* nothing open */ }
    for (const name of [UNIDENTIFIED_DATABASE_NAME, FARMER_DB]) await Dexie.delete(name);
    localStorage.clear();
    await resetDatabase();
}

beforeEach(async () => {
    await wipe();
    setActiveDatabaseName(FARMER_DB); // signed in: his own database is active
    linkMock.mockReset();
    __resetNoticeReacceptanceForTests();
    setOnline(true);
});
afterEach(async () => {
    vi.restoreAllMocks();
    await wipe();
});

describe('who is asked', () => {
    it('lane OPS-1 (L-4): a server read that never answers is cut off, and he is asked (could not tell)', async () => {
        // Real timers on purpose (Dexie stalls under fake ones); the limit is a parameter so the wait is short.
        const never = vi.fn(() => new Promise<string | null>(() => undefined));
        const started = Date.now();
        await expect(needsNoticeReacceptance(never, 60)).resolves.toBe(true);
        expect(Date.now() - started).toBeLessThan(5_000);
        expect(never).toHaveBeenCalledTimes(1);
        expect(SERVER_CHECK_LIMIT_MS).toBeLessThanOrEqual(10_000);
    });

    it('a farmer whose phone holds only the OLDER acceptance is asked', async () => {
        await getDatabase().uiPrefs.put({ key: ACCEPTED_NOTICE_PREF_KEY, value: OLD_NOTICE });
        expect(await needsNoticeReacceptance(async () => OLD_NOTICE)).toBe(true);
    });

    it('lane F99 fix pass 2 (D-71, material): a farmer who accepted notice-2026-10-30.1 is asked once, and keeps no new voice until he ticks', async () => {
        await getDatabase().uiPrefs.put({ key: ACCEPTED_NOTICE_PREF_KEY, value: 'notice-2026-10-30.1' });
        expect(await hasCoreConsent()).toBe(false);
        expect(await needsNoticeReacceptance(async () => 'notice-2026-10-30.1')).toBe(true);
    });

    it('a phone that already holds the notice in force is not asked, and the server is not called', async () => {
        await getDatabase().uiPrefs.put({ key: ACCEPTED_NOTICE_PREF_KEY, value: NOTICE_VERSION });
        const server = vi.fn(async () => null);
        expect(await needsNoticeReacceptance(server)).toBe(false);
        expect(server).not.toHaveBeenCalled();
    });

    it('accepted on another phone (the server says so): not asked again, and this phone is marked', async () => {
        expect(await needsNoticeReacceptance(async () => NOTICE_VERSION)).toBe(false);
        expect(await pref(ACCEPTED_NOTICE_PREF_KEY)).toBe(NOTICE_VERSION);
        expect(await hasCoreConsent()).toBe(true);
    });

    it('a server that cannot be read means ASK — never "already accepted"', async () => {
        expect(await needsNoticeReacceptance(async () => { throw new Error('offline'); })).toBe(true);
        expect(await needsNoticeReacceptance(async () => null)).toBe(true);
        expect(await needsNoticeReacceptance(async () => undefined)).toBe(true);
        expect(await hasCoreConsent()).toBe(false);
    });
});

describe('accepting', () => {
    it('queues on the phone, marks it, and sends the acceptance for the notice in force in the background', async () => {
        linkMock.mockResolvedValue(twoIds);
        expect(await recordNoticeReacceptance('mr')).toBe('queued');
        expect(await hasCoreConsent()).toBe(true);

        await settle();
        expect(linkMock).toHaveBeenCalledTimes(1);
        const sent = linkMock.mock.calls[0][0];
        expect(sent.noticeVersion).toBe(NOTICE_VERSION);
        expect(sent.displayedLanguage).toBe('mr');
        expect(sent.displayedNoticeText).toBe(canonicalNoticeText('mr'));
        expect(await pref(PENDING_REACCEPTANCE_PREF_KEY)).toBeUndefined();
    });

    it('a STALLED network never holds him: it returns as soon as the queue write lands, phone marked', async () => {
        linkMock.mockImplementation(stalled);
        const started = Date.now();
        expect(await recordNoticeReacceptance('mr')).toBe('queued');
        expect(Date.now() - started).toBeLessThan(1_500);
        expect(await hasCoreConsent()).toBe(true);
        const queued = (await pref(PENDING_REACCEPTANCE_PREF_KEY)) as { noticeVersion: string };
        expect(queued.noticeVersion).toBe(NOTICE_VERSION);
    });

    it('offline: queued and marked at once (no recording is lost); sent when the phone is online again', async () => {
        setOnline(false);
        expect(await recordNoticeReacceptance('en')).toBe('queued');
        expect(await hasCoreConsent()).toBe(true);
        await settle();
        expect(linkMock).not.toHaveBeenCalled();
        const queued = (await pref(PENDING_REACCEPTANCE_PREF_KEY)) as { displayedLanguage: string };
        expect(queued.displayedLanguage).toBe('en');

        setOnline(true);
        linkMock.mockResolvedValue(twoIds);
        expect(await flushNoticeReacceptance()).toBe('sent');
        expect(await pref(PENDING_REACCEPTANCE_PREF_KEY)).toBeUndefined();
    });

    it('a failed send keeps the acceptance queued (never silently dropped) and a later send succeeds', async () => {
        linkMock.mockRejectedValueOnce(new Error('503'));
        expect(await recordNoticeReacceptance('mr')).toBe('queued');
        await settle();
        expect(await pref(PENDING_REACCEPTANCE_PREF_KEY)).toBeDefined();

        linkMock.mockResolvedValue(twoIds);
        expect(await flushNoticeReacceptance()).toBe('sent');
        expect(linkMock.mock.calls[0][0].preRegistrationSessionId)
            .toBe(linkMock.mock.calls[1][0].preRegistrationSessionId);
        expect(await pref(PENDING_REACCEPTANCE_PREF_KEY)).toBeUndefined();
    });

    it('the phone cannot queue: one direct send; when it lands the phone is marked', async () => {
        vi.spyOn(getDatabase().uiPrefs, 'put').mockRejectedValueOnce(new Error('wedged IndexedDB'));
        linkMock.mockResolvedValue(twoIds);
        expect(await recordNoticeReacceptance('mr')).toBe('sent');
        expect(linkMock).toHaveBeenCalledTimes(1);
        expect(await hasCoreConsent()).toBe(true);
    });

    it('queue write AND direct send both fail: the phone is NOT marked, and a retry works', async () => {
        vi.spyOn(getDatabase().uiPrefs, 'put').mockRejectedValueOnce(new Error('wedged IndexedDB'));
        linkMock.mockRejectedValueOnce(new Error('offline'));
        expect(await recordNoticeReacceptance('mr')).toBe('failed');
        expect(await hasCoreConsent()).toBe(false);
        expect(await pref(PENDING_REACCEPTANCE_PREF_KEY)).toBeUndefined();

        linkMock.mockResolvedValue(twoIds);
        expect(await recordNoticeReacceptance('mr')).toBe('queued');
        expect(await hasCoreConsent()).toBe(true);
    });

    it('never touches a login acceptance that is still waiting to be linked', async () => {
        const loginLink = { preRegistrationSessionId: 'login-1', noticeVersion: OLD_NOTICE };
        await getDatabase().uiPrefs.put({ key: PENDING_CONSENT_GATE_LINK_PREF_KEY, value: loginLink });
        linkMock.mockResolvedValue(twoIds);
        await recordNoticeReacceptance('mr');
        await settle();
        expect(await pref(PENDING_CONSENT_GATE_LINK_PREF_KEY)).toEqual(loginLink);
    });

    it('nothing queued: a flush sends nothing', async () => {
        expect(await flushNoticeReacceptance()).toBe('nothing-pending');
        expect(linkMock).not.toHaveBeenCalled();
    });
});
