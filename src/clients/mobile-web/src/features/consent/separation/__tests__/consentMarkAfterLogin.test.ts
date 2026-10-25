// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// spec: plr-d10-redesign-real-integration-2026-10-25 (I1 / X6 — acceptance a, b, c, d, e)
//
// Authored by test-writer from the spec alone.
//
// THE DEFECT. The farmer ticks consent at the phone-number screen, BEFORE sign-in, so the
// device mark lands in the pre-login database `AgriLogDB_unidentified`. Sign-in then
// switches the app to HIS database. If the mark is only looked for in the active database,
// a farmer who did consent has his offline voice capture thrown away.
//
// Everything below is real: Dexie over fake-indexeddb, and the real database switch
// (`setActiveDatabaseName`) between the pre-login database and a per-user one. Nothing is
// mocked, because the defect lives exactly in WHICH database a read lands on.

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    AgriLogDatabase,
    getDatabase,
    resetDatabase,
} from '../../../../infrastructure/storage/DexieDatabase';
import {
    getActiveDatabaseName,
    setActiveDatabaseName,
} from '../../../../infrastructure/storage/activeDatabaseName';
import {
    LEGACY_DATABASE_NAME,
    UNIDENTIFIED_DATABASE_NAME,
    perUserDatabaseName,
} from '../../../../infrastructure/storage/userDatabaseName';
import {
    CoreConsentMissingError,
    hasCoreConsent,
    markCoreConsentOnThisDevice,
} from '../coreConsentGate';
import { NOTICE_VERSION } from '../../gate/consentNotice';
import { PendingInterpretationStore } from '../../../voice/continuity/PendingInterpretationStore';
import type { PendingInterpretationRecord } from '../../../voice/continuity/pendingInterpretation';

/** The uiPrefs key the spec names for the device consent mark. */
const MARK_KEY = 'shramsafal_consent_gate_accepted_notice';
const OLD_NOTICE_VERSION = 'notice-2020-01-01.1';

const PRE_LOGIN = UNIDENTIFIED_DATABASE_NAME;
const FARMER_DB = perUserDatabaseName('test'); // 'AgriLogDB_u_test'

// ── helpers ──────────────────────────────────────────────────────────────────────────

async function databaseExists(name: string): Promise<boolean> {
    const list = await indexedDB.databases();
    return list.some((d) => d.name === name);
}

/**
 * Read one uiPrefs value from a NAMED database without switching the app and without
 * creating that database when it is absent.
 */
async function prefIn(databaseName: string, key: string): Promise<unknown> {
    if (!(await databaseExists(databaseName))) return undefined;
    const db = new AgriLogDatabase(databaseName);
    try {
        return (await db.uiPrefs.get(key))?.value;
    } finally {
        db.close();
    }
}

/** Write a uiPrefs row into a database the way the app does: make it active, then put. */
async function putPrefWhileActive(databaseName: string, key: string, value: unknown): Promise<void> {
    setActiveDatabaseName(databaseName);
    await getDatabase().uiPrefs.put({ key, value });
}

/** Sign-in, as far as storage is concerned: the farmer's own database becomes active. */
function signIn(): void {
    setActiveDatabaseName(FARMER_DB);
}

const audioCapture = (): PendingInterpretationRecord => ({
    captureId: 'cap-audio-1',
    farmId: 'farm-1',
    createdAtUtc: 0,
    status: 'pending',
    ladderLevel: 'audio-only',
    transcript: null,
    audioBase64: 'BASE64AUDIO',
    audioMimeType: 'audio/webm',
    logScopeJson: '{}',
    recordedAtUtc: '2026-10-25T06:00:00.000Z',
    attempts: 0,
    lastAttemptAtUtc: null,
});

async function wipe(): Promise<void> {
    try { await resetDatabase(); } catch { /* nothing open */ }
    for (const name of [PRE_LOGIN, FARMER_DB, LEGACY_DATABASE_NAME]) {
        await Dexie.delete(name);
    }
    localStorage.clear();
    await resetDatabase();
}

beforeEach(wipe);
afterEach(wipe);

// ─────────────────────────────────────────────────────────────────────────────────────
describe('(a) a mark written before sign-in counts after the switch to his own database', () => {
    it('markCoreConsentOnThisDevice() at the pre-login screen → signed in → hasCoreConsent() is true', async () => {
        setActiveDatabaseName(PRE_LOGIN);
        await markCoreConsentOnThisDevice();
        // Precondition: the mark landed where the phone-number screen runs.
        expect(await prefIn(PRE_LOGIN, MARK_KEY)).toBe(NOTICE_VERSION);

        signIn();
        expect(getActiveDatabaseName()).toBe(FARMER_DB);
        // His own database has never seen the mark — the answer must come from the
        // pre-login database, which is the whole defect.
        expect(await getDatabase().uiPrefs.get(MARK_KEY)).toBeUndefined();

        await expect(hasCoreConsent()).resolves.toBe(true);
    });

    it('a current mark already sitting in the pre-login database (no new write) is honoured after sign-in', async () => {
        await putPrefWhileActive(PRE_LOGIN, MARK_KEY, NOTICE_VERSION);

        signIn();
        expect(await getDatabase().uiPrefs.get(MARK_KEY)).toBeUndefined();

        await expect(hasCoreConsent()).resolves.toBe(true);
    });

    it('the pre-login mark is still honoured when the per-user database already existed', async () => {
        // A farmer who has used this phone before: his database exists and has other rows.
        signIn();
        await getDatabase().uiPrefs.put({ key: 'some_other_pref', value: 'x' });

        // He signs out, consents again at the phone-number screen, and signs back in.
        await putPrefWhileActive(PRE_LOGIN, MARK_KEY, NOTICE_VERSION);
        signIn();

        await expect(hasCoreConsent()).resolves.toBe(true);
    });
});

describe('(b) only the CURRENT notice counts', () => {
    it('an old-version pre-login mark → false after the switch', async () => {
        await putPrefWhileActive(PRE_LOGIN, MARK_KEY, OLD_NOTICE_VERSION);

        signIn();

        await expect(hasCoreConsent()).resolves.toBe(false);
    });

    it('an old version in BOTH databases → false', async () => {
        await putPrefWhileActive(PRE_LOGIN, MARK_KEY, OLD_NOTICE_VERSION);
        await putPrefWhileActive(FARMER_DB, MARK_KEY, OLD_NOTICE_VERSION);
        expect(getActiveDatabaseName()).toBe(FARMER_DB);

        await expect(hasCoreConsent()).resolves.toBe(false);
    });
});

describe('(c) no pre-login database → false, and asking does not create it', () => {
    it('hasCoreConsent() is false and AgriLogDB_unidentified still does not exist', async () => {
        expect(await databaseExists(PRE_LOGIN)).toBe(false);

        signIn();
        await expect(hasCoreConsent()).resolves.toBe(false);

        expect(await databaseExists(PRE_LOGIN)).toBe(false);
    });

    it('asking twice still creates nothing', async () => {
        signIn();
        await hasCoreConsent();
        await hasCoreConsent();

        expect(await databaseExists(PRE_LOGIN)).toBe(false);
    });
});

describe('(d) a mark written while his own database is active', () => {
    it('lands in the ACTIVE database and hasCoreConsent() is true', async () => {
        signIn();

        await markCoreConsentOnThisDevice();

        expect((await getDatabase().uiPrefs.get(MARK_KEY))?.value).toBe(NOTICE_VERSION);
        expect(await prefIn(FARMER_DB, MARK_KEY)).toBe(NOTICE_VERSION);
        await expect(hasCoreConsent()).resolves.toBe(true);
    });

    it('does not create the pre-login database on the way', async () => {
        signIn();

        await markCoreConsentOnThisDevice();
        await hasCoreConsent();

        expect(await databaseExists(PRE_LOGIN)).toBe(false);
    });

    it('markCoreConsentOnThisDevice() never throws, even when the active database is unusable', async () => {
        signIn();
        // A closed Dexie handle does not re-open by itself: every write on it rejects.
        getDatabase().close();

        await expect(markCoreConsentOnThisDevice()).resolves.toBeUndefined();
    });

    it('an unreadable active database with no pre-login database fails CLOSED', async () => {
        signIn();
        getDatabase().close();

        await expect(hasCoreConsent()).resolves.toBe(false);
    });
});

describe('(e) the voice-clip store after the switch', () => {
    it('persists an audio capture into his database when the pre-login mark is current', async () => {
        await putPrefWhileActive(PRE_LOGIN, MARK_KEY, NOTICE_VERSION);
        signIn();

        await expect(PendingInterpretationStore.getInstance().persist(audioCapture())).resolves.toBeUndefined();

        const stored = await getDatabase().pendingInterpretations.get('cap-audio-1');
        expect(stored?.audioBase64).toBe('BASE64AUDIO');
        expect(getDatabase().name).toBe(FARMER_DB);
    });

    it('persists when the mark came from markCoreConsentOnThisDevice() before sign-in', async () => {
        setActiveDatabaseName(PRE_LOGIN);
        await markCoreConsentOnThisDevice();
        signIn();

        await PendingInterpretationStore.getInstance().persist(audioCapture());

        expect(await getDatabase().pendingInterpretations.get('cap-audio-1')).toBeDefined();
    });

    it('throws CoreConsentMissingError and stores nothing when the pre-login mark is an old version', async () => {
        await putPrefWhileActive(PRE_LOGIN, MARK_KEY, OLD_NOTICE_VERSION);
        signIn();

        await expect(PendingInterpretationStore.getInstance().persist(audioCapture()))
            .rejects.toBeInstanceOf(CoreConsentMissingError);

        expect(await getDatabase().pendingInterpretations.get('cap-audio-1')).toBeUndefined();
    });

    it('throws CoreConsentMissingError, stores nothing and creates no pre-login database when there is none', async () => {
        signIn();

        await expect(PendingInterpretationStore.getInstance().persist(audioCapture()))
            .rejects.toBeInstanceOf(CoreConsentMissingError);

        expect(await getDatabase().pendingInterpretations.get('cap-audio-1')).toBeUndefined();
        expect(await databaseExists(PRE_LOGIN)).toBe(false);
    });
});
