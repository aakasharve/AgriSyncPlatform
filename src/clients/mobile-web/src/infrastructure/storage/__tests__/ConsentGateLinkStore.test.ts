// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// spec: 2026-08-25-prod-cutover-waves (B1)
//
// The device's memory of what the consent gate displayed. `fake-indexeddb/auto` gives a
// real IndexedDB, so every write below is the write the phone performs.
//
// What is pinned here is the part a well-meaning cleanup deletes:
//
//   • THE PAYLOAD SURVIVES. It is the only copy of the facts — the accepting row on the
//     server is readable by no role, so if this is lost the acceptance can never be
//     attached to anyone.
//   • ONE OWNER, RECORDED ONCE. `claimedByUserId` is written on the first attempt and
//     never re-bound, because a linking row naming the wrong person is a false statement
//     in an append-only legal ledger.
//   • A MALFORMED ROW READS AS NOTHING. A payload the server would refuse as "incomplete
//     evidence" must not be retried forever.

import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase } from '../DexieDatabase';
import {
    PENDING_CONSENT_GATE_LINK_PREF_KEY,
    claimPendingConsentGateLink,
    clearPendingConsentGateLink,
    readPendingConsentGateLink,
    savePendingConsentGateLink,
    type PendingConsentGateLink,
} from '../ConsentGateLinkStore';

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

beforeEach(async () => {
    const db = getDatabase();
    try { await db.delete(); } catch { /* first run */ }
    await resetDatabase();
});

describe('ConsentGateLinkStore', () => {
    it('keeps every fact the link endpoint needs across a read', async () => {
        await savePendingConsentGateLink(pending());

        const read = await readPendingConsentGateLink();

        expect(read).toEqual(pending());
    });

    it('reads as nothing when no acceptance is waiting', async () => {
        expect(await readPendingConsentGateLink()).toBeNull();
    });

    it('binds the first account that authenticates, and never re-binds', async () => {
        await savePendingConsentGateLink(pending());

        const first = await claimPendingConsentGateLink('user-1');
        expect(first?.claimedByUserId).toBe('user-1');

        // A second account signing in on the same device does not take the acceptance.
        const second = await claimPendingConsentGateLink('user-2');
        expect(second?.claimedByUserId).toBe('user-1');
        expect((await readPendingConsentGateLink())?.claimedByUserId).toBe('user-1');
    });

    it('claims nothing when there is nothing pending', async () => {
        expect(await claimPendingConsentGateLink('user-1')).toBeNull();
    });

    it('clears the payload only when asked, and clearing an absent one is safe', async () => {
        await savePendingConsentGateLink(pending());
        await clearPendingConsentGateLink();
        expect(await readPendingConsentGateLink()).toBeNull();

        await expect(clearPendingConsentGateLink()).resolves.toBeUndefined();
    });

    it.each([
        ['no notice text', { displayedNoticeText: '' }],
        ['no purpose codes', { acceptedPurposeCodes: [] }],
        ['no data category codes', { dataCategoryCodes: [] }],
        ['no session id', { preRegistrationSessionId: '   ' }],
        ['no notice version', { noticeVersion: '' }],
        ['no app version', { appVersion: '' }],
    ])('reads a payload with %s as nothing — the server would refuse it anyway', async (_label, broken) => {
        await getDatabase().uiPrefs.put({
            key: PENDING_CONSENT_GATE_LINK_PREF_KEY,
            value: { ...pending(), ...broken },
        });

        expect(await readPendingConsentGateLink()).toBeNull();
    });

    it.each([
        ['an unrecognised source', { source: 'sms' }],
        ['a non-object row', 'not-a-payload'],
        ['null', null],
    ])('reads %s as nothing rather than throwing', async (_label, value) => {
        await getDatabase().uiPrefs.put({
            key: PENDING_CONSENT_GATE_LINK_PREF_KEY,
            value: typeof value === 'object' && value !== null ? { ...pending(), ...value } : value,
        });

        await expect(readPendingConsentGateLink()).resolves.toBeNull();
    });
});
