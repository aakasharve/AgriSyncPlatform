// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// spec: plr-d10-redesign-real-integration-2026-10-25 (I1 / X6 — acceptance g); rewritten for the permissions page in
// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A).
//
// The consent step is now the ONE long permissions page, opened by `recordIfNeeded()` and accepted only by his
// deliberate tap (`accept`). Pinned here, as before:
//   (p) the page opens and NOTHING is sent until the tap; "नको" sends nothing and says it was declined;
//   (g) when `recordIfNeeded()` resolves, the device mark is already on disk (so the number is sent after it);
//   (j) a stuck IndexedDB never holds the number back (the mark write gives up after 2 s; the guard fails closed);
//   (h) an acceptance belongs to the phone number it was given for;
//   (s) the two switches are held on the phone with the acceptance, after the accepting write and never before.
//
// Mocked: the network (consentGateApi), the link store (consentGateLinkReconciler) and the app language. Real: Dexie over
// fake-indexeddb, the real database switch, the real mark write (wrapped only to hold it back like a slow disk).

import React from 'react';
import Dexie from 'dexie';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    record: vi.fn(),
    remember: vi.fn(),
    markGate: null as Promise<void> | null,
    markCalls: 0,
}));

vi.mock('../../../../i18n/LanguageContext', () => {
    const value = { language: 'mr' as const, setLanguage: () => undefined, t: (key: string) => key };
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
        markCoreConsentOnThisDevice: async (version?: string): Promise<void> => {
            h.markCalls += 1;
            if (h.markGate) await h.markGate;
            await actual.markCoreConsentOnThisDevice(version);
        },
    };
});

import { PermissionsDeclinedError, isPermissionsDeclined, useConsentBeforeOtp, type ConsentBeforeOtp } from '../useConsentBeforeOtp';
import { PAGE_NOTICE_VERSION } from '../consentNotice';
import { canonicalPermissionsPageText } from '../../permissionsPage/permissionsPageNotice';
import { hasCoreConsent } from '../../separation/coreConsentGate';
import { readHeldSwitchChoices } from '../../../../infrastructure/storage/HeldSwitchChoicesStore';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { setActiveDatabaseName } from '../../../../infrastructure/storage/activeDatabaseName';
import {
    LEGACY_DATABASE_NAME,
    UNIDENTIFIED_DATABASE_NAME,
    perUserDatabaseName,
} from '../../../../infrastructure/storage/userDatabaseName';

const MARK_KEY = 'shramsafal_consent_gate_accepted_notice';
const PRE_LOGIN = UNIDENTIFIED_DATABASE_NAME;
const FARMER_DB = perUserDatabaseName('test');
const IDS = { termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1' };
const BOTH_ON = { voicePlayback: true, improvement: true };

const markInActiveDatabase = async (): Promise<unknown> => (await getDatabase().uiPrefs.get(MARK_KEY))?.value;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

type HookResult = { current: ConsentBeforeOtp };

/**
 * Taps send: the page opens. Returns the pending call WRAPPED - an async function that returned the promise itself
 * would wait for it (an awaited promise adopts the one it returns), and it only settles on the page's answer.
 */
async function ask(rendered: HookResult): Promise<{ call: Promise<void> }> {
    let call: Promise<void> = Promise.resolve();
    act(() => { call = rendered.current.recordIfNeeded(); });
    call.catch(() => undefined); // a test that declines reads the rejection itself
    await waitFor(() => expect(rendered.current.pageOpen).toBe(true));
    return { call };
}

async function askAndAccept(rendered: HookResult, choices = BOTH_ON): Promise<unknown> {
    const { call } = await ask(rendered);
    let markWhenResolved: unknown = 'not read';
    await act(async () => {
        rendered.current.accept(choices);
        await call;
        markWhenResolved = await markInActiveDatabase();
    });
    return markWhenResolved;
}

async function wipe(): Promise<void> {
    try { await resetDatabase(); } catch { /* nothing open */ }
    for (const name of [PRE_LOGIN, FARMER_DB, LEGACY_DATABASE_NAME]) await Dexie.delete(name);
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

describe('(p) the page opens from the send, and only the deliberate tap records', () => {
    it('opens the page, sends nothing while it is open, and the send stays possible (not held by a tick)', async () => {
        const { result } = renderHook(() => useConsentBeforeOtp('9876543210'));
        expect(result.current.pageOpen).toBe(false);
        expect(result.current.canSend).toBe(true);
        await ask(result);
        await settle();
        expect(h.record).not.toHaveBeenCalled();
        expect(h.markCalls).toBe(0);
    });

    it('a second tap on send while the page is open gets the SAME pending answer (one page, one record)', async () => {
        const { result } = renderHook(() => useConsentBeforeOtp('9876543210'));
        const { call: first } = await ask(result);
        let second: Promise<void> = Promise.resolve();
        act(() => { second = result.current.recordIfNeeded(); });
        expect(second).toBe(first);
        await act(async () => { result.current.accept(BOTH_ON); await first; });
        expect(h.record).toHaveBeenCalledTimes(1);
    });

    it('the record carries the PAGE edition: its version and the exact page text that was on screen', async () => {
        const { result } = renderHook(() => useConsentBeforeOtp('9876543210'));
        await askAndAccept(result);
        const acceptance = h.record.mock.calls[0][0] as { noticeVersion: string; canonicalNotice: string; ageDeclaredAdult: boolean };
        expect(acceptance.noticeVersion).toBe(PAGE_NOTICE_VERSION);
        expect(acceptance.canonicalNotice).toBe(canonicalPermissionsPageText('mr'));
        expect(acceptance.ageDeclaredAdult).toBe(true);
    });

    it('"नको" rejects as DECLINED, closes the page, sends nothing and marks nothing', async () => {
        const { result } = renderHook(() => useConsentBeforeOtp('9876543210'));
        const { call } = await ask(result);
        let caught: unknown = null;
        await act(async () => {
            result.current.decline();
            try { await call; } catch (e) { caught = e; }
        });
        expect(caught).toBeInstanceOf(PermissionsDeclinedError);
        expect(isPermissionsDeclined(caught)).toBe(true);
        expect(result.current.pageOpen).toBe(false);
        expect(result.current.status).toBe('required');
        expect(h.record).not.toHaveBeenCalled();
        expect(await markInActiveDatabase()).toBeUndefined();
        expect(await readHeldSwitchChoices()).toBeNull();
    });
});

describe('(g) when recordIfNeeded() resolves, the mark is already in the active database', () => {
    it('at the phone-number screen (pre-login database active)', async () => {
        const { result } = renderHook(() => useConsentBeforeOtp());
        const mark = await askAndAccept(result);
        expect(getDatabase().name).toBe(PRE_LOGIN);
        expect(mark).toBe(PAGE_NOTICE_VERSION);
        expect(h.markCalls).toBe(1);
        await expect(hasCoreConsent()).resolves.toBe(true);
    });

    it('with a signed-in farmer\'s own database active, and hasCoreConsent() agrees', async () => {
        setActiveDatabaseName(FARMER_DB);
        const { result } = renderHook(() => useConsentBeforeOtp());
        const mark = await askAndAccept(result);
        expect(getDatabase().name).toBe(FARMER_DB);
        expect(mark).toBe(PAGE_NOTICE_VERSION);
        await expect(hasCoreConsent()).resolves.toBe(true);
    });

    it('on a slow disk, recordIfNeeded() does not resolve until the mark has been written', async () => {
        let releaseDisk: () => void = () => undefined;
        h.markGate = new Promise<void>((resolve) => { releaseDisk = resolve; });
        const { result } = renderHook(() => useConsentBeforeOtp());
        const { call } = await ask(result);
        let resolved = false;
        void call.then(() => { resolved = true; }, () => { resolved = true; });
        act(() => result.current.accept(BOTH_ON));

        await waitFor(() => expect(h.markCalls).toBe(1));
        expect(h.record).toHaveBeenCalledTimes(1);
        await settle();
        expect(resolved).toBe(false);
        expect(await markInActiveDatabase()).toBeUndefined();

        await act(async () => { releaseDisk(); await call; });
        expect(resolved).toBe(true);
        expect(await markInActiveDatabase()).toBe(PAGE_NOTICE_VERSION);
    });

    it('a failed accept writes no mark, holds no switches, and rejects with the failure (not as declined)', async () => {
        h.record.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useConsentBeforeOtp());
        const { call } = await ask(result);
        let caught: unknown = null;
        await act(async () => {
            result.current.accept(BOTH_ON);
            try { await call; } catch (e) { caught = e; }
        });
        await settle();
        expect(caught).toBeInstanceOf(Error);
        expect(isPermissionsDeclined(caught)).toBe(false);
        expect(h.markCalls).toBe(0);
        expect(await markInActiveDatabase()).toBeUndefined();
        expect(await readHeldSwitchChoices()).toBeNull();
    });
});

const WRITE_METHODS = ['put', 'add', 'bulkPut', 'bulkAdd', 'update', 'upsert'] as const;

function jamWritesOnActiveUiPrefs(): () => void {
    const table = getDatabase().uiPrefs as unknown as Record<string, unknown>;
    const jammed: string[] = [];
    for (const method of WRITE_METHODS) {
        if (typeof table[method] === 'function') {
            table[method] = () => new Promise<never>(() => undefined);
            jammed.push(method);
        }
    }
    return () => { for (const method of jammed) delete table[method]; };
}

describe('(j) a stuck IndexedDB never holds the number back', () => {
    it('when the mark write never settles, recordIfNeeded() still resolves within ~2 s, and the guard fails closed', async () => {
        const { result } = renderHook(() => useConsentBeforeOtp());
        const unjam = jamWritesOnActiveUiPrefs();
        try {
            const { call } = await ask(result);
            let outcome = 'not settled';
            let elapsedMs = -1;
            await act(async () => {
                const started = Date.now();
                result.current.accept(BOTH_ON);
                outcome = await Promise.race([
                    call.then(() => 'resolved', () => 'rejected'),
                    new Promise<string>((resolve) => setTimeout(() => resolve('still waiting after 3.5 s'), 3500)),
                ]);
                elapsedMs = Date.now() - started;
            });
            expect(outcome).toBe('resolved');
            expect(elapsedMs).toBeLessThan(3500);
            expect(result.current.status).toBe('passed');
        } finally {
            unjam();
        }
        expect(await markInActiveDatabase()).toBeUndefined();
        await expect(hasCoreConsent()).resolves.toBe(false);
    });
});

describe('(h) an acceptance belongs to the phone number it was given for', () => {
    const PHONE_A = '9876543210';
    const PHONE_B = '9123456780';

    it('accepted for A: A sends again without the page; B opens the page again and is recorded with a new session id', async () => {
        const { result, rerender } = renderHook(
            ({ phone }: { phone: string }) => useConsentBeforeOtp(phone),
            { initialProps: { phone: PHONE_A } },
        );
        await askAndAccept(result);
        expect(result.current.status).toBe('passed');

        // A again (back from the OTP step): no page, no record.
        await act(async () => { await result.current.recordIfNeeded(); });
        expect(result.current.pageOpen).toBe(false);
        expect(h.record).toHaveBeenCalledTimes(1);

        rerender({ phone: PHONE_B });
        await waitFor(() => expect(result.current.status).toBe('required'));
        await askAndAccept(result);
        expect(h.record).toHaveBeenCalledTimes(2);
        expect(h.record.mock.calls[1][1]).not.toBe(h.record.mock.calls[0][1]);
        expect(result.current.status).toBe('passed');
    });
});

describe('(s) the two switches are held with the acceptance', () => {
    it('as he left them, with the acceptance\'s own session id, only after the accepting write landed', async () => {
        let landAccept: (v: typeof IDS) => void = () => undefined;
        h.record.mockImplementation(() => new Promise((resolve) => { landAccept = resolve; }));
        const { result } = renderHook(() => useConsentBeforeOtp('9876543210'));
        const { call } = await ask(result);
        act(() => result.current.accept({ voicePlayback: false, improvement: true }));
        await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
        await settle();
        expect(await readHeldSwitchChoices()).toBeNull();

        await act(async () => { landAccept(IDS); await call; });
        await waitFor(async () => expect(await readHeldSwitchChoices()).not.toBeNull());
        const held = await readHeldSwitchChoices();
        expect(held).toMatchObject({ voicePlayback: false, improvement: true, language: 'mr' });
        expect(held?.preRegistrationSessionId).toBe(h.record.mock.calls[0][1]);
    });
});
