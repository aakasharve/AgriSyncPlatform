// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves (B1)
//
// The floor under doctrine P9, tested where it is hardest to hold: when the DEVICE's own
// storage is the thing that is broken.
//
// The reconciler runs beside the auth path. A rejected promise there becomes an unhandled
// rejection, which `installGlobalErrorHandlers` reports as a JS crash — for a farmer whose
// only sin was opening the app on a phone with a wedged IndexedDB. So every store call is
// forced to reject here, one at a time, and the reconciler still has to answer with an
// outcome rather than an exception.
//
// Separate file from `consentGateLinkReconciler.test.ts` because that one runs against a
// REAL Dexie over fake-indexeddb — the two mock postures cannot share a module registry.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    claimPendingConsentGateLink,
    clearPendingConsentGateLink,
    readPendingConsentGateLink,
    savePendingConsentGateLink,
} from '../../../../infrastructure/storage/ConsentGateLinkStore';
import { linkConsentGateToUser } from '../../../../infrastructure/consent/ConsentGateLinkClient';
import {
    __resetConsentGateLinkReconcilerForTests,
    reconcileConsentGateLink,
    rememberConsentGateAcceptanceForLinking,
} from '../consentGateLinkReconciler';

vi.mock('../../../../infrastructure/storage/ConsentGateLinkStore', () => ({
    readPendingConsentGateLink: vi.fn(),
    savePendingConsentGateLink: vi.fn(),
    claimPendingConsentGateLink: vi.fn(),
    clearPendingConsentGateLink: vi.fn(),
}));
vi.mock('../../../../infrastructure/consent/ConsentGateLinkClient', () => ({
    linkConsentGateToUser: vi.fn(),
}));

const readMock = vi.mocked(readPendingConsentGateLink);
const saveMock = vi.mocked(savePendingConsentGateLink);
const claimMock = vi.mocked(claimPendingConsentGateLink);
const clearMock = vi.mocked(clearPendingConsentGateLink);
const linkMock = vi.mocked(linkConsentGateToUser);

const storedPayload = {
    preRegistrationSessionId: 'preauth-abc',
    noticeVersion: 'notice-2026-08-17.5',
    privacyPolicyVersion: 'privacy-2026-08-17.1',
    termsVersion: 'terms-2026-08-17.1',
    displayedLanguage: 'mr',
    acceptedPurposeCodes: ['CORE_FARM_RECORD'],
    dataCategoryCodes: ['FARM_ACTIVITY'],
    source: 'app' as const,
    appVersion: '0.9.0',
    displayedNoticeText: 'शेतीची नोंद ठेवण्यासाठी…',
};

const twoIds = { termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1', alreadyLinked: false };

beforeEach(() => {
    vi.clearAllMocks();
    __resetConsentGateLinkReconcilerForTests();
    readMock.mockResolvedValue(storedPayload);
    saveMock.mockResolvedValue(undefined);
    claimMock.mockResolvedValue({ ...storedPayload, claimedByUserId: 'user-1' });
    clearMock.mockResolvedValue(undefined);
    linkMock.mockResolvedValue(twoIds);
});

describe('reconcileConsentGateLink — never rejects, whatever breaks', () => {
    it('answers when the READ of the pending payload rejects', async () => {
        readMock.mockRejectedValue(new Error('IndexedDB unavailable'));

        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('deferred');
    });

    it('answers when the CLAIM write rejects', async () => {
        claimMock.mockRejectedValue(new Error('QuotaExceededError'));

        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('deferred');
    });

    it('answers when the CLEAR after a confirmed link rejects', async () => {
        clearMock.mockRejectedValue(new Error('IndexedDB closed'));

        // The link itself landed. A failure to forget it locally is not a farmer's
        // problem — the endpoint is idempotent, so the next start replays harmlessly.
        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('deferred');
        expect(linkMock).toHaveBeenCalledTimes(1);
    });

    it('answers when the network call rejects', async () => {
        linkMock.mockRejectedValue(new Error('Network Error'));

        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('deferred');
        expect(clearMock).not.toHaveBeenCalled();
    });
});

describe('rememberConsentGateAcceptanceForLinking — never rejects', () => {
    it('swallows a storage failure rather than holding the farmer on the gate', async () => {
        saveMock.mockRejectedValue(new Error('IndexedDB unavailable'));

        await expect(rememberConsentGateAcceptanceForLinking({
            displayedLanguage: 'mr',
            noticeVersion: 'notice-2026-08-17.5',
            termsVersion: 'terms-2026-08-17.1',
            privacyPolicyVersion: 'privacy-2026-08-17.1',
            purposeCodes: ['CORE_FARM_RECORD'] as never,
            dataCategoryCodes: ['FARM_ACTIVITY'] as never,
            canonicalNotice: 'शेतीची नोंद ठेवण्यासाठी…',
            ageDeclaredAdult: true,
        }, 'preauth-abc')).resolves.toBeUndefined();
    });
});
