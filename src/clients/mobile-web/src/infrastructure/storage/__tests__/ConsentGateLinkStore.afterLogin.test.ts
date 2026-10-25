// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// spec: plr-d10-redesign-real-integration-2026-10-25 (I1 / X6 — acceptance f)
//
// Authored by test-writer from the spec alone.
//
// The consent acceptance is remembered for linking at the phone-number screen, BEFORE
// sign-in, so the pending link payload lands in the pre-login database
// `AgriLogDB_unidentified`. The link retry runs AFTER sign-in, when the farmer's own
// database is active. The retry must still find the payload, bind it to him in the
// database that holds it, and clear it from every database once the server confirms.
//
// Real Dexie over fake-indexeddb and the real database switch. The store is not mocked at
// all; for (i) the reconciler runs for real too, and only its network call
// (`linkConsentGateToUser`) is stubbed.
//
// Amended (B001–B003, acceptance i): `clearPendingConsentGateLink(preRegistrationSessionId?)`
// removes only payloads with that session id (no argument = all), and the reconciler passes
// the id it linked — so linking one acceptance never erases a different, unlinked one.

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ link: vi.fn() }));

vi.mock('../../consent/ConsentGateLinkClient', () => ({
    linkConsentGateToUser: (...a: unknown[]) => h.link(...a),
}));

import { AgriLogDatabase, getDatabase, resetDatabase } from '../DexieDatabase';
import { getActiveDatabaseName, setActiveDatabaseName } from '../activeDatabaseName';
import {
    LEGACY_DATABASE_NAME,
    UNIDENTIFIED_DATABASE_NAME,
    perUserDatabaseName,
} from '../userDatabaseName';
import {
    PENDING_CONSENT_GATE_LINK_PREF_KEY,
    claimPendingConsentGateLink,
    clearPendingConsentGateLink,
    readPendingConsentGateLink,
    savePendingConsentGateLink,
    type PendingConsentGateLink,
} from '../ConsentGateLinkStore';
import {
    __resetConsentGateLinkReconcilerForTests,
    reconcileConsentGateLink,
} from '../../../features/consent/gate/consentGateLinkReconciler';

const PRE_LOGIN = UNIDENTIFIED_DATABASE_NAME;
const FARMER_DB = perUserDatabaseName('test'); // 'AgriLogDB_u_test'
const OTHER_FARMER_DB = perUserDatabaseName('other');

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

// ── helpers ──────────────────────────────────────────────────────────────────────────

async function databaseExists(name: string): Promise<boolean> {
    const list = await indexedDB.databases();
    return list.some((d) => d.name === name);
}

/**
 * The pending-link row as it sits in a NAMED database — read without switching the app
 * and without creating that database when it is absent.
 */
async function linkRowIn(databaseName: string): Promise<Record<string, unknown> | undefined> {
    if (!(await databaseExists(databaseName))) return undefined;
    const db = new AgriLogDatabase(databaseName);
    try {
        return (await db.uiPrefs.get(PENDING_CONSENT_GATE_LINK_PREF_KEY))?.value as
            | Record<string, unknown>
            | undefined;
    } finally {
        db.close();
    }
}

/** The phone-number screen: the pre-login database is active. */
async function saveBeforeSignIn(payload: PendingConsentGateLink = pending()): Promise<void> {
    setActiveDatabaseName(PRE_LOGIN);
    await savePendingConsentGateLink(payload);
    // Precondition: it really is in the pre-login database.
    expect((await linkRowIn(PRE_LOGIN))?.preRegistrationSessionId).toBe(payload.preRegistrationSessionId);
}

/** Sign-in, as far as storage is concerned: a farmer's own database becomes active. */
function signIn(databaseName: string = FARMER_DB): void {
    setActiveDatabaseName(databaseName);
    expect(getActiveDatabaseName()).toBe(databaseName);
}

async function wipe(): Promise<void> {
    try { await resetDatabase(); } catch { /* nothing open */ }
    for (const name of [PRE_LOGIN, FARMER_DB, OTHER_FARMER_DB, LEGACY_DATABASE_NAME]) {
        await Dexie.delete(name);
    }
    localStorage.clear();
    await resetDatabase();
}

beforeEach(async () => {
    await wipe();
    __resetConsentGateLinkReconcilerForTests();
    h.link.mockReset();
    h.link.mockResolvedValue({ termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1', alreadyLinked: false });
});
afterEach(wipe);

// ─────────────────────────────────────────────────────────────────────────────────────
describe('(f) a link payload saved before sign-in, handled after the switch', () => {
    it('end to end: read after the switch, claimed (claim persists), then cleared from both databases', async () => {
        await saveBeforeSignIn();
        signIn();

        // read
        expect(await readPendingConsentGateLink()).toEqual(pending());

        // claim — and the claim survives a fresh read
        const claimed = await claimPendingConsentGateLink('user-1');
        expect(claimed?.claimedByUserId).toBe('user-1');
        expect((await readPendingConsentGateLink())?.claimedByUserId).toBe('user-1');

        // clear — gone from BOTH databases
        await clearPendingConsentGateLink();
        expect(await readPendingConsentGateLink()).toBeNull();
        expect(await linkRowIn(PRE_LOGIN)).toBeUndefined();
        expect(await linkRowIn(FARMER_DB)).toBeUndefined();
    });

    it('reads every fact of the pre-login payload from his own database', async () => {
        await saveBeforeSignIn();
        signIn();

        // His own database does not hold it — the read has to reach the pre-login one.
        expect((await getDatabase().uiPrefs.get(PENDING_CONSENT_GATE_LINK_PREF_KEY))).toBeUndefined();
        expect(await readPendingConsentGateLink()).toEqual(pending());
    });

    it('binds claimedByUserId in the database that HOLDS the payload (the pre-login one)', async () => {
        await saveBeforeSignIn();
        signIn();

        await claimPendingConsentGateLink('user-1');

        expect((await linkRowIn(PRE_LOGIN))?.claimedByUserId).toBe('user-1');
    });

    it('a claim made from one farmer\'s database is not re-bound by a second account later', async () => {
        await saveBeforeSignIn();
        signIn(FARMER_DB);
        await claimPendingConsentGateLink('user-1');

        // A different person signs in on the same phone while the link is still pending.
        signIn(OTHER_FARMER_DB);
        const second = await claimPendingConsentGateLink('user-2');

        expect(second?.claimedByUserId).toBe('user-1');
        expect((await readPendingConsentGateLink())?.claimedByUserId).toBe('user-1');
        expect((await linkRowIn(PRE_LOGIN))?.claimedByUserId).toBe('user-1');
    });

    it('clearing after the switch removes a pre-login payload', async () => {
        await saveBeforeSignIn();
        signIn();

        await clearPendingConsentGateLink();

        expect(await readPendingConsentGateLink()).toBeNull();
        expect(await linkRowIn(PRE_LOGIN)).toBeUndefined();
    });

    it('clearing removes the payload from BOTH databases when each holds one', async () => {
        await saveBeforeSignIn(pending({ preRegistrationSessionId: 'preauth-old' }));
        signIn();
        await savePendingConsentGateLink(pending({ preRegistrationSessionId: 'preauth-new' }));
        expect((await linkRowIn(FARMER_DB))?.preRegistrationSessionId).toBe('preauth-new');

        await clearPendingConsentGateLink();

        expect(await linkRowIn(PRE_LOGIN)).toBeUndefined();
        expect(await linkRowIn(FARMER_DB)).toBeUndefined();
        expect(await readPendingConsentGateLink()).toBeNull();
    });

    it('the active database is looked in first', async () => {
        await saveBeforeSignIn(pending({ preRegistrationSessionId: 'preauth-old' }));
        signIn();
        await savePendingConsentGateLink(pending({ preRegistrationSessionId: 'preauth-new' }));

        expect((await readPendingConsentGateLink())?.preRegistrationSessionId).toBe('preauth-new');
    });
});

describe('(i) clearing by session id leaves a different acceptance in place', () => {
    const P1 = () => pending({ preRegistrationSessionId: 'S1' });
    const P2 = () => pending({ preRegistrationSessionId: 'S2', displayedLanguage: 'en' });

    /** P1 saved before sign-in (pre-login database), P2 saved after it (his database). */
    async function seedBoth(): Promise<void> {
        await saveBeforeSignIn(P1());
        signIn();
        await savePendingConsentGateLink(P2());
        expect((await linkRowIn(FARMER_DB))?.preRegistrationSessionId).toBe('S2');
    }

    it('store: linking P2 (read → claim) and clearing with S2 leaves P1 in place', async () => {
        await seedBoth();

        const linked = await claimPendingConsentGateLink('user-1');
        expect(linked?.preRegistrationSessionId).toBe('S2');

        await clearPendingConsentGateLink('S2');

        expect(await linkRowIn(FARMER_DB)).toBeUndefined();
        expect((await linkRowIn(PRE_LOGIN))?.preRegistrationSessionId).toBe('S1');
        expect(await readPendingConsentGateLink()).toMatchObject({
            preRegistrationSessionId: 'S1',
            displayedLanguage: 'mr',
        });
    });

    it('store: clearing with S1 removes only P1 and leaves P2', async () => {
        await seedBoth();

        await clearPendingConsentGateLink('S1');

        expect(await linkRowIn(PRE_LOGIN)).toBeUndefined();
        expect((await linkRowIn(FARMER_DB))?.preRegistrationSessionId).toBe('S2');
        expect((await readPendingConsentGateLink())?.preRegistrationSessionId).toBe('S2');
    });

    it('store: clearing with an id nobody holds removes nothing and does not throw', async () => {
        await seedBoth();

        await expect(clearPendingConsentGateLink('S-nobody')).resolves.toBeUndefined();

        expect((await linkRowIn(PRE_LOGIN))?.preRegistrationSessionId).toBe('S1');
        expect((await linkRowIn(FARMER_DB))?.preRegistrationSessionId).toBe('S2');
    });

    it('store: clearing with no argument still removes both, as before', async () => {
        await seedBoth();

        await clearPendingConsentGateLink();

        expect(await linkRowIn(PRE_LOGIN)).toBeUndefined();
        expect(await linkRowIn(FARMER_DB)).toBeUndefined();
    });

    it('reconciler: linking P2 sends S2, clears only S2, and P1 stays for the next attempt', async () => {
        await seedBoth();

        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('linked');

        expect(h.link).toHaveBeenCalledTimes(1);
        expect((h.link.mock.calls[0][0] as PendingConsentGateLink).preRegistrationSessionId).toBe('S2');
        expect(await linkRowIn(FARMER_DB)).toBeUndefined();
        expect((await linkRowIn(PRE_LOGIN))?.preRegistrationSessionId).toBe('S1');
        expect((await readPendingConsentGateLink())?.preRegistrationSessionId).toBe('S1');
    });

    it('reconciler: P1 that stayed behind is what the next attempt sends, and then nothing is left', async () => {
        await seedBoth();
        await reconcileConsentGateLink('user-1');
        __resetConsentGateLinkReconcilerForTests();

        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('linked');

        expect(h.link).toHaveBeenCalledTimes(2);
        expect((h.link.mock.calls[1][0] as PendingConsentGateLink).preRegistrationSessionId).toBe('S1');
        expect(await readPendingConsentGateLink()).toBeNull();
    });

    it('reconciler: a failed link clears nothing', async () => {
        await seedBoth();
        h.link.mockRejectedValueOnce(new Error('offline'));

        await expect(reconcileConsentGateLink('user-1')).resolves.toBe('deferred');

        expect((await linkRowIn(PRE_LOGIN))?.preRegistrationSessionId).toBe('S1');
        expect((await linkRowIn(FARMER_DB))?.preRegistrationSessionId).toBe('S2');
    });
});

describe('a payload saved while a per-user database is active', () => {
    it('is read back', async () => {
        signIn();

        await savePendingConsentGateLink(pending());

        expect(await readPendingConsentGateLink()).toEqual(pending());
        expect((await linkRowIn(FARMER_DB))?.preRegistrationSessionId).toBe('preauth-abc');
    });

    it('is claimed in place and the claim persists', async () => {
        signIn();
        await savePendingConsentGateLink(pending());

        await claimPendingConsentGateLink('user-1');

        expect((await readPendingConsentGateLink())?.claimedByUserId).toBe('user-1');
        expect((await linkRowIn(FARMER_DB))?.claimedByUserId).toBe('user-1');
    });

    it('is cleared', async () => {
        signIn();
        await savePendingConsentGateLink(pending());

        await clearPendingConsentGateLink();

        expect(await readPendingConsentGateLink()).toBeNull();
        expect(await linkRowIn(FARMER_DB)).toBeUndefined();
    });
});

describe('no pre-login database at all', () => {
    it('read, claim and clear report nothing, never throw, and never create the pre-login database', async () => {
        signIn();

        await expect(readPendingConsentGateLink()).resolves.toBeNull();
        await expect(claimPendingConsentGateLink('user-1')).resolves.toBeNull();
        await expect(clearPendingConsentGateLink()).resolves.toBeUndefined();

        expect(await databaseExists(PRE_LOGIN)).toBe(false);
    });
});

describe('still never throws', () => {
    it('with the active database unusable', async () => {
        signIn();
        // A closed Dexie handle does not re-open by itself: every call on it rejects.
        getDatabase().close();

        await expect(savePendingConsentGateLink(pending())).resolves.toBeUndefined();
        await expect(readPendingConsentGateLink()).resolves.toBeNull();
        await expect(claimPendingConsentGateLink('user-1')).resolves.toBeNull();
        await expect(clearPendingConsentGateLink()).resolves.toBeUndefined();
    });
});
