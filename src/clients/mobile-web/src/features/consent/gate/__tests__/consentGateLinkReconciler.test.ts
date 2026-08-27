// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// spec: 2026-08-25-prod-cutover-waves (B1)
//
// The pre-login acceptance finding its account. Real Dexie (`fake-indexeddb/auto`), real
// store; only the network call is mocked, because the whole behaviour under test is what
// the DEVICE does between attempts.
//
// Each of these pins a property that a later "simplify the retry" change would break, and
// every one of them is invisible to the farmer by design:
//
//   • IT RETRIES AFTER A FAILURE — the payload is untouched by anything except a
//     confirmed success, so the next app start cannot tell a failed attempt from an
//     attempt that never happened. Offline is normal, not exceptional.
//   • IT DOES NOT RE-SEND AFTER SUCCESS — the ledgers are append-only; a client that keeps
//     shouting is a client relying on the server's idempotency to cover for it.
//   • IT NEVER REJECTS — it runs beside the auth path, and doctrine P9 says no optional
//     field may ever reject a record.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import {
    claimPendingConsentGateLink,
    readPendingConsentGateLink,
    savePendingConsentGateLink,
    type PendingConsentGateLink,
} from '../../../../infrastructure/storage/ConsentGateLinkStore';
import { linkConsentGateToUser } from '../../../../infrastructure/consent/ConsentGateLinkClient';
import {
    __resetConsentGateLinkReconcilerForTests,
    reconcileConsentGateLink,
    rememberConsentGateAcceptanceForLinking,
} from '../consentGateLinkReconciler';
import { canonicalNoticeText, NOTICE_VERSION, PRIVACY_POLICY_VERSION, TERMS_VERSION } from '../consentNotice';
import { CORE_DATA_CATEGORY_CODES, CORE_PURPOSE_CODES } from '../../../../domain/consent/CoreConsentScope';

vi.mock('../../../../infrastructure/consent/ConsentGateLinkClient', () => ({
    linkConsentGateToUser: vi.fn(),
}));

const linkMock = vi.mocked(linkConsentGateToUser);

const twoIds = { termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1', alreadyLinked: false };

const pending = (overrides: Partial<PendingConsentGateLink> = {}): PendingConsentGateLink => ({
    preRegistrationSessionId: 'preauth-abc',
    noticeVersion: 'notice-2026-08-17.5',
    privacyPolicyVersion: 'privacy-2026-08-17.1',
    termsVersion: 'terms-2026-08-17.1',
    displayedLanguage: 'mr',
    acceptedPurposeCodes: ['CORE_FARM_RECORD'],
    dataCategoryCodes: ['FARM_ACTIVITY'],
    source: 'app',
    appVersion: '0.9.0',
    displayedNoticeText: 'शेतीची नोंद ठेवण्यासाठी…',
    ...overrides,
});

const setOnline = (value: boolean) => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
};

beforeEach(async () => {
    const db = getDatabase();
    try { await db.delete(); } catch { /* first run */ }
    await resetDatabase();
    linkMock.mockReset();
    __resetConsentGateLinkReconcilerForTests();
    setOnline(true);
});

describe('rememberConsentGateAcceptanceForLinking', () => {
    it('stores exactly what the gate displayed, including the notice text itself', async () => {
        await rememberConsentGateAcceptanceForLinking({
            displayedLanguage: 'mr',
            noticeVersion: NOTICE_VERSION,
            termsVersion: TERMS_VERSION,
            privacyPolicyVersion: PRIVACY_POLICY_VERSION,
            purposeCodes: CORE_PURPOSE_CODES,
            dataCategoryCodes: CORE_DATA_CATEGORY_CODES,
            canonicalNotice: canonicalNoticeText('mr'),
            ageDeclaredAdult: true,
        }, 'preauth-xyz');

        const stored = await readPendingConsentGateLink();
        expect(stored).not.toBeNull();
        expect(stored?.preRegistrationSessionId).toBe('preauth-xyz');
        expect(stored?.noticeVersion).toBe(NOTICE_VERSION);
        expect(stored?.termsVersion).toBe(TERMS_VERSION);
        expect(stored?.privacyPolicyVersion).toBe(PRIVACY_POLICY_VERSION);
        expect(stored?.displayedLanguage).toBe('mr');
        expect(stored?.acceptedPurposeCodes).toEqual([...CORE_PURPOSE_CODES]);
        expect(stored?.dataCategoryCodes).toEqual([...CORE_DATA_CATEGORY_CODES]);
        // The TEXT, not a hash — the server hashes what it is told was displayed.
        expect(stored?.displayedNoticeText).toBe(canonicalNoticeText('mr'));
        expect(['app', 'web']).toContain(stored?.source);
        // Nobody has authenticated yet, so nothing owns it.
        expect(stored?.claimedByUserId).toBeUndefined();
    });
});

describe('reconcileConsentGateLink', () => {
    it('sends the stored facts and clears the payload once BOTH rows are confirmed', async () => {
        await savePendingConsentGateLink(pending());
        linkMock.mockResolvedValue(twoIds);

        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('linked');

        expect(linkMock).toHaveBeenCalledTimes(1);
        expect(linkMock.mock.calls[0][0]).toMatchObject({
            preRegistrationSessionId: 'preauth-abc',
            displayedNoticeText: 'शेतीची नोंद ठेवण्यासाठी…',
            claimedByUserId: 'user-1',
        });
        expect(await readPendingConsentGateLink()).toBeNull();
    });

    it('DOES NOT RE-SEND after a success — the ledgers are append-only', async () => {
        await savePendingConsentGateLink(pending());
        linkMock.mockResolvedValue(twoIds);

        await reconcileConsentGateLink('user-1');
        __resetConsentGateLinkReconcilerForTests();
        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('nothing-pending');

        expect(linkMock).toHaveBeenCalledTimes(1);
    });

    it('RETRIES after a failure — a failed attempt leaves the device exactly as it was', async () => {
        await savePendingConsentGateLink(pending());
        linkMock.mockRejectedValueOnce(new Error('500'));

        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('deferred');
        expect(await readPendingConsentGateLink()).not.toBeNull();

        // Next app start.
        __resetConsentGateLinkReconcilerForTests();
        linkMock.mockResolvedValueOnce(twoIds);
        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('linked');

        expect(linkMock).toHaveBeenCalledTimes(2);
        expect(await readPendingConsentGateLink()).toBeNull();
    });

    it('treats a replay (alreadyLinked) as the success it is', async () => {
        await savePendingConsentGateLink(pending());
        linkMock.mockResolvedValue({ ...twoIds, alreadyLinked: true });

        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('linked');
        expect(await readPendingConsentGateLink()).toBeNull();
    });

    it('does not call the server when the device says it is offline, and keeps the payload', async () => {
        await savePendingConsentGateLink(pending());
        setOnline(false);

        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('offline');

        expect(linkMock).not.toHaveBeenCalled();
        // Indistinguishable from "not yet tried" on the next attempt.
        expect(await readPendingConsentGateLink()).toEqual(pending());
    });

    it('does nothing at all when no account is signed in', async () => {
        await savePendingConsentGateLink(pending());

        await expect(reconcileConsentGateLink(null)).resolves.toBe('no-account');
        __resetConsentGateLinkReconcilerForTests();
        await expect(reconcileConsentGateLink(undefined)).resolves.toBe('no-account');

        expect(linkMock).not.toHaveBeenCalled();
    });

    it('does nothing when no acceptance is waiting', async () => {
        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('nothing-pending');
        expect(linkMock).not.toHaveBeenCalled();
    });

    it('refuses to attach a pending acceptance to a DIFFERENT account, and keeps it', async () => {
        await savePendingConsentGateLink(pending());
        await claimPendingConsentGateLink('user-1');

        await expect(reconcileConsentGateLink('user-2')).resolves.toBe('other-account');

        expect(linkMock).not.toHaveBeenCalled();
        // Still there — if user-1 signs back in on this device the link completes.
        expect((await readPendingConsentGateLink())?.claimedByUserId).toBe('user-1');
    });

    it('runs one attempt at a time — StrictMode double-invoke does not double-send', async () => {
        await savePendingConsentGateLink(pending());
        linkMock.mockResolvedValue(twoIds);

        const [a, b] = await Promise.all([
            reconcileConsentGateLink('user-1'),
            reconcileConsentGateLink('user-1'),
        ]);

        expect(a).toBe('linked');
        expect(b).toBe('linked');
        expect(linkMock).toHaveBeenCalledTimes(1);
    });

    it('NEVER REJECTS when the network call throws — doctrine P9', async () => {
        await savePendingConsentGateLink(pending());
        linkMock.mockRejectedValue(new Error('offline'));

        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('deferred');
    });
});
