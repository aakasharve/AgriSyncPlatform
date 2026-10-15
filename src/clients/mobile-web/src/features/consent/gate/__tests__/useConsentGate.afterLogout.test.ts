// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves
/**
 * Offline-session audit P3: "consent gate re-shown after offline logout".
 * Real Dexie (fake-indexeddb) + real database routing. Question: does a device
 * that PASSED the gate before login see it again after a login -> logout cycle?
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useConsentGate } from '../useConsentGate';
import { resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { activateDatabaseForUser } from '../../../../infrastructure/storage/activateUserDatabase';
import { endFarmerSessionLocally } from '../../../../infrastructure/storage/endFarmerSession';
import { setActiveDatabaseName } from '../../../../infrastructure/storage/activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME } from '../../../../infrastructure/storage/userDatabaseName';

describe('consent gate across login -> logout', () => {
    beforeEach(async () => {
        try { await resetDatabase(); } catch { /* none */ }
        await Dexie.delete(UNIDENTIFIED_DATABASE_NAME);
        window.localStorage.clear();
        setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME);
    });

    it('a device that passed the gate pre-login does NOT see it again after logout (fresh mount)', async () => {
        const first = renderHook(() => useConsentGate());
        await waitFor(() => expect(first.result.current.status).toBe('required'));
        act(() => first.result.current.markPassed());
        await waitFor(() => expect(first.result.current.status).toBe('passed'));
        await new Promise((r) => setTimeout(r, 50)); // let the Dexie put land
        first.unmount();

        activateDatabaseForUser('user-A'); // login
        endFarmerSessionLocally();         // logout (clearAuthSession path)

        const after = renderHook(() => useConsentGate());
        await waitFor(() => expect(after.result.current.status).not.toBe('undecided'));
        expect(after.result.current.status).toBe('passed');
    });

    it('F1 (reproduced 2026-10-12): accepted pre-login, app restored signed in on the farmer DB, then logout -> NEVER re-gated, never even flashed', async () => {
        // Accept pre-login (unidentified DB), as the real gate does.
        const first = renderHook(() => useConsentGate());
        await waitFor(() => expect(first.result.current.status).toBe('required'));
        act(() => first.result.current.markPassed());
        await waitFor(() => expect(first.result.current.status).toBe('passed'));
        await new Promise((r) => setTimeout(r, 50));
        first.unmount();

        // Cold start of an already signed-in app: the farmer's DB is active BEFORE the
        // gate hook reads (presence session). Her DB has no gate row -> 'required', hidden
        // only because App.tsx never gates an authenticated session.
        activateDatabaseForUser('user-A');
        const seen: string[] = [];
        const mounted = renderHook(() => {
            const g = useConsentGate();
            seen.push(g.status);
            return g;
        });
        await waitFor(() => expect(mounted.result.current.status).not.toBe('undecided'));
        seen.length = 0;

        endFarmerSessionLocally(); // logout: routing returns to the unidentified DB

        await waitFor(() => expect(mounted.result.current.status).toBe('passed'));
        expect(seen).not.toContain('required'); // no flash of the consent screen
    });

    it('a device that NEVER passed the gate here (e.g. signed in by another route) is still gated after logout', async () => {
        activateDatabaseForUser('user-A');
        endFarmerSessionLocally();
        const after = renderHook(() => useConsentGate());
        await waitFor(() => expect(after.result.current.status).not.toBe('undecided'));
        expect(after.result.current.status).toBe('required');
    });
});
