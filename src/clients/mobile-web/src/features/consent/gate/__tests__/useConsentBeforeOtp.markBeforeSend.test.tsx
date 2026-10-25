// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// spec: plr-d10-redesign-real-integration-2026-10-25 (I1 / X6 — acceptance g)
//
// Authored by test-writer from the spec alone.
//
// "after a successful accept, `await markCoreConsentOnThisDevice()` BEFORE
// `recordIfNeeded()` resolves (so the mark is on disk before the number is sent)."
//
// The page sends the phone number the moment `recordIfNeeded()` resolves. If the device
// mark is still on its way to disk at that point, a farmer who goes offline right after
// signing in can lose his first voice capture although he consented. So the order is
// pinned here, including against a slow disk.
//
// Mocked: the network (consentGateApi), the link store (consentGateLinkReconciler) and the
// app language. Real: Dexie over fake-indexeddb, the real database switch, and the real
// `markCoreConsentOnThisDevice` — wrapped only so a test can hold it back like a slow disk.
//
// Amended (B001–B003): (j) the awaited mark write gives up after 2 s, so a stuck IndexedDB
// never holds the number back (the guard then fails closed); and, at hook level, (h) an
// acceptance belongs to the phone number it was given for — `useConsentBeforeOtp(phone)`.

import React from 'react';
import Dexie from 'dexie';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    record: vi.fn(),
    remember: vi.fn(),
    /** While set, the mark write has not started yet — a slow disk. */
    markGate: null as Promise<void> | null,
    markCalls: 0,
}));

vi.mock('../../../../i18n/LanguageContext', () => {
    const value = {
        language: 'mr' as const,
        setLanguage: () => undefined,
        t: (key: string) => key,
    };
    return {
        useLanguage: () => value,
        useOptionalLanguage: () => value,
        LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
    };
});

vi.mock('../consentGateApi', () => ({
    recordConsentGateAcceptance: (...a: unknown[]) => h.record(...a),
    resolveConsentSource: () => 'web',
}));

vi.mock('../consentGateLinkReconciler', () => ({
    rememberConsentGateAcceptanceForLinking: (...a: unknown[]) => h.remember(...a),
    reconcileConsentGateLink: async () => 'nothing-pending',
    __resetConsentGateLinkReconcilerForTests: () => undefined,
}));

vi.mock('../../separation/coreConsentGate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../separation/coreConsentGate')>();
    return {
        ...actual,
        markCoreConsentOnThisDevice: async (): Promise<void> => {
            h.markCalls += 1;
            if (h.markGate) await h.markGate;
            await actual.markCoreConsentOnThisDevice();
        },
    };
});

import { useConsentBeforeOtp } from '../useConsentBeforeOtp';
import { NOTICE_VERSION } from '../consentNotice';
import { hasCoreConsent } from '../../separation/coreConsentGate';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { setActiveDatabaseName } from '../../../../infrastructure/storage/activeDatabaseName';
import {
    LEGACY_DATABASE_NAME,
    UNIDENTIFIED_DATABASE_NAME,
    perUserDatabaseName,
} from '../../../../infrastructure/storage/userDatabaseName';

/** The uiPrefs key the spec names for the device consent mark. */
const MARK_KEY = 'shramsafal_consent_gate_accepted_notice';
const PRE_LOGIN = UNIDENTIFIED_DATABASE_NAME;
const FARMER_DB = perUserDatabaseName('test'); // 'AgriLogDB_u_test'
const IDS = { termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1' };

/** The mark as it stands in whichever database is ACTIVE right now. */
const markInActiveDatabase = async (): Promise<unknown> => (await getDatabase().uiPrefs.get(MARK_KEY))?.value;

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

async function renderTicked() {
    const rendered = renderHook(() => useConsentBeforeOtp());
    act(() => rendered.result.current.setTicked(true));
    await waitFor(() => expect(rendered.result.current.canSend).toBe(true));
    return rendered;
}

async function wipe(): Promise<void> {
    try { await resetDatabase(); } catch { /* nothing open */ }
    for (const name of [PRE_LOGIN, FARMER_DB, LEGACY_DATABASE_NAME]) {
        await Dexie.delete(name);
    }
    localStorage.clear();
    await resetDatabase();
}

beforeEach(async () => {
    await wipe();
    setActiveDatabaseName(PRE_LOGIN);
    h.record.mockReset();
    h.record.mockResolvedValue(IDS);
    h.remember.mockReset();
    h.remember.mockResolvedValue(undefined);
    h.markGate = null;
    h.markCalls = 0;
});

afterEach(async () => {
    cleanup();
    await wipe();
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('(g) when recordIfNeeded() resolves, the mark is already in the active database', () => {
    it('at the phone-number screen (pre-login database active)', async () => {
        const { result } = await renderTicked();
        expect(await markInActiveDatabase()).toBeUndefined();

        let markWhenResolved: unknown = 'not read';
        await act(async () => {
            await result.current.recordIfNeeded();
            // Read on the very next step — no waiting for a background write to catch up.
            markWhenResolved = await markInActiveDatabase();
        });

        expect(getDatabase().name).toBe(PRE_LOGIN);
        expect(markWhenResolved).toBe(NOTICE_VERSION);
        expect(h.markCalls).toBe(1);
    });

    it('with a signed-in farmer\'s own database active, and hasCoreConsent() agrees', async () => {
        setActiveDatabaseName(FARMER_DB);
        const { result } = await renderTicked();

        let markWhenResolved: unknown = 'not read';
        await act(async () => {
            await result.current.recordIfNeeded();
            markWhenResolved = await markInActiveDatabase();
        });

        expect(getDatabase().name).toBe(FARMER_DB);
        expect(markWhenResolved).toBe(NOTICE_VERSION);
        await expect(hasCoreConsent()).resolves.toBe(true);
    });

    it('on a slow disk, recordIfNeeded() does not resolve until the mark has been written', async () => {
        let releaseDisk: () => void = () => undefined;
        h.markGate = new Promise<void>((resolve) => { releaseDisk = resolve; });
        const { result } = await renderTicked();

        let resolved = false;
        let call: Promise<void> = Promise.resolve();
        act(() => {
            call = result.current.recordIfNeeded();
            void call.then(() => { resolved = true; }, () => { resolved = true; });
        });

        // The accept landed and the mark was asked for…
        await waitFor(() => expect(h.markCalls).toBe(1));
        expect(h.record).toHaveBeenCalledTimes(1);
        await settle();
        // …but the disk has not taken it yet, so the number may not be sent yet.
        expect(resolved).toBe(false);
        expect(await markInActiveDatabase()).toBeUndefined();

        let markWhenResolved: unknown = 'not read';
        await act(async () => {
            releaseDisk();
            await call;
            markWhenResolved = await markInActiveDatabase();
        });

        expect(resolved).toBe(true);
        expect(markWhenResolved).toBe(NOTICE_VERSION);
    });

    it('the mark is asked for only AFTER the accept has landed on the server', async () => {
        let landAccept: (v: typeof IDS) => void = () => undefined;
        h.record.mockImplementation(() => new Promise((resolve) => { landAccept = resolve; }));
        const { result } = await renderTicked();

        let call: Promise<void> = Promise.resolve();
        act(() => { call = result.current.recordIfNeeded(); });
        await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
        await settle();

        expect(h.markCalls).toBe(0);
        expect(await markInActiveDatabase()).toBeUndefined();

        let markWhenResolved: unknown = 'not read';
        await act(async () => {
            landAccept(IDS);
            await call;
            markWhenResolved = await markInActiveDatabase();
        });

        expect(h.markCalls).toBe(1);
        expect(markWhenResolved).toBe(NOTICE_VERSION);
    });

    it('a failed accept writes no mark', async () => {
        h.record.mockRejectedValue(new Error('offline'));
        const { result } = await renderTicked();

        let caught: unknown = null;
        await act(async () => {
            try { await result.current.recordIfNeeded(); } catch (e) { caught = e; }
        });
        await settle();

        expect(caught).toBeInstanceOf(Error);
        expect(h.markCalls).toBe(0);
        expect(await markInActiveDatabase()).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────
/** Every write a Table offers. Stubbed on the ACTIVE handle to model a stuck IndexedDB. */
const WRITE_METHODS = ['put', 'add', 'bulkPut', 'bulkAdd', 'update', 'upsert'] as const;

function jamWritesOnActiveUiPrefs(): () => void {
    const table = getDatabase().uiPrefs as unknown as Record<string, unknown>;
    const jammed: string[] = [];
    for (const method of WRITE_METHODS) {
        if (typeof table[method] === 'function') {
            table[method] = () => new Promise<never>(() => undefined); // never settles
            jammed.push(method);
        }
    }
    return () => { for (const method of jammed) delete table[method]; };
}

describe('(j) a stuck IndexedDB never holds the number back', () => {
    it('when the mark write never settles, recordIfNeeded() still resolves within ~2 s, and the guard fails closed', async () => {
        const { result } = await renderTicked();
        const unjam = jamWritesOnActiveUiPrefs();
        try {
            let outcome = 'not settled';
            let elapsedMs = -1;
            await act(async () => {
                const started = Date.now();
                outcome = await Promise.race([
                    result.current.recordIfNeeded().then(() => 'resolved', () => 'rejected'),
                    new Promise<string>((resolve) => setTimeout(() => resolve('still waiting after 3.5 s'), 3500)),
                ]);
                elapsedMs = Date.now() - started;
            });

            expect(outcome).toBe('resolved');
            expect(elapsedMs).toBeLessThan(3500);
            expect(h.record).toHaveBeenCalledTimes(1);
            expect(result.current.status).toBe('passed');
            expect(result.current.canSend).toBe(true);
        } finally {
            unjam();
        }

        // The mark never landed, so the voice-clip guard says no: fail CLOSED.
        expect(await markInActiveDatabase()).toBeUndefined();
        await expect(hasCoreConsent()).resolves.toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('(h) hook level — an acceptance belongs to the phone number it was given for', () => {
    const PHONE_A = '9876543210';
    const PHONE_B = '9123456780';

    it('accepted for A → the number becomes B → required, unticked, refuses until ticked, and B is recorded with a new session id', async () => {
        const { result, rerender } = renderHook(
            ({ phone }: { phone: string }) => useConsentBeforeOtp(phone),
            { initialProps: { phone: PHONE_A } },
        );
        act(() => result.current.setTicked(true));
        await waitFor(() => expect(result.current.canSend).toBe(true));
        await act(async () => { await result.current.recordIfNeeded(); });

        expect(result.current.status).toBe('passed');
        // A successful accept clears the tick.
        expect(result.current.ticked).toBe(false);
        expect(result.current.canSend).toBe(true);

        rerender({ phone: PHONE_B });

        await waitFor(() => expect(result.current.status).toBe('required'));
        expect(result.current.ticked).toBe(false);
        expect(result.current.canSend).toBe(false);

        let caught: unknown = null;
        await act(async () => {
            try { await result.current.recordIfNeeded(); } catch (e) { caught = e ?? 'thrown'; }
        });
        expect(caught).not.toBeNull();
        expect(h.record).toHaveBeenCalledTimes(1);

        act(() => result.current.setTicked(true));
        await waitFor(() => expect(result.current.canSend).toBe(true));
        await act(async () => { await result.current.recordIfNeeded(); });

        expect(h.record).toHaveBeenCalledTimes(2);
        const firstId = h.record.mock.calls[0][1];
        const secondId = h.record.mock.calls[1][1];
        expect(typeof secondId).toBe('string');
        expect((secondId as string).length).toBeGreaterThan(0);
        expect(secondId).not.toBe(firstId);
        expect(result.current.status).toBe('passed');
    });

    it('the default number is the empty string — useConsentBeforeOtp() and useConsentBeforeOtp(\'\') behave alike', async () => {
        const { result, rerender } = renderHook(
            ({ phone }: { phone?: string }) => useConsentBeforeOtp(phone),
            { initialProps: { phone: undefined as string | undefined } },
        );
        act(() => result.current.setTicked(true));
        await waitFor(() => expect(result.current.canSend).toBe(true));
        await act(async () => { await result.current.recordIfNeeded(); });
        expect(result.current.status).toBe('passed');

        rerender({ phone: '' });
        await settle();
        expect(result.current.status).toBe('passed');
        expect(result.current.canSend).toBe(true);
    });
});
