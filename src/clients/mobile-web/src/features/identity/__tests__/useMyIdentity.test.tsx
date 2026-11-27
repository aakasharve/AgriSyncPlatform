// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6; doctrine P10) - his card on the phone:
 *   - the server's answer is shown (and kept as a disposable copy);
 *   - a save is "माहिती जतन झाली" ONLY after the server's 200; offline or failed it stays "पाठवायचं बाकी" (unsynchronised intent, never पूर्ण) and goes
 *     once the network is back;
 *   - another phone saved first (409): nothing is overwritten; the server's card is read again and his edits stay in the form;
 *   - a refusal (400) is said, and not sent again.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        uiPrefs: {
            get: async (key: string) => (rows.has(key) ? { key, value: rows.get(key) } : undefined),
            put: async (row: { key: string; value: unknown }) => { rows.set(row.key, row.value); },
        },
    }),
}));
vi.mock('../../../infrastructure/storage/activeDatabaseName', () => ({ onActiveDatabaseChanged: () => () => { /* none */ } }));

import { useMyIdentity, type IdentityApi } from '../useMyIdentity';
import type { IdentityCallResult, MyIdentity } from '../identityApi';
import type { IdentityForm } from '../identityForm';

const card = (over: Partial<MyIdentity> = {}): MyIdentity => ({
    userId: 'u1', version: 1, fullName: 'Raju Bhosale', fullNameScript: 'latn', nameMr: null, nameEn: null, phone: '+919999954321',
    phoneVerifiedAtUtc: '2026-11-20T10:00:00Z', farmerId: null, village: null, taluka: null, district: null, placeListVersion: null,
    pinCode: null, photo: null, complete: false, updatedAtUtc: '2026-11-20T10:00:00Z', ...over,
});
const form: IdentityForm = { fullName: 'Raju Bhosale', nameMr: null, nameEn: null, farmerId: '', village: { kind: 'typed', text: 'वाडी' }, taluka: null, district: null, pin: null };

const api = (get: IdentityCallResult[], put: IdentityCallResult[]): IdentityApi & { puts: unknown[] } => {
    const puts: unknown[] = [];
    return {
        puts,
        get: vi.fn(async (): Promise<IdentityCallResult> => get.shift() ?? { kind: 'offline' }),
        put: vi.fn(async (body: unknown): Promise<IdentityCallResult> => { puts.push(body); return put.shift() ?? { kind: 'offline' }; }),
    };
};

beforeEach(() => { rows.clear(); });

describe('useMyIdentity', () => {
    it('shows the server\'s card and keeps a copy for the next open', async () => {
        const a = api([{ kind: 'ok', card: card({ version: 2 }) }], []);
        const { result } = renderHook(() => useMyIdentity('u1', a));
        await waitFor(() => expect(result.current.card?.version).toBe(2));
        expect(rows.get('identity:card:u1')).toMatchObject({ version: 2 });
    });

    it('"saved" only after the server\'s 200, against the version it last read', async () => {
        const a = api([{ kind: 'ok', card: card({ version: 2 }) }], [{ kind: 'ok', card: card({ version: 3, complete: true }) }]);
        const { result } = renderHook(() => useMyIdentity('u1', a));
        await waitFor(() => expect(result.current.card?.version).toBe(2));
        await act(async () => { await result.current.save(form); });
        expect(a.puts[0]).toMatchObject({ expectedVersion: 2, village: { typed: 'वाडी' } });
        expect(result.current.saveState).toBe('saved');
        expect(result.current.card?.complete).toBe(true);
        expect(rows.get('identity:pending:u1')).toBeNull();
    });

    it('offline: kept as "पाठवायचं बाकी" (the step is not done from a phone copy), then sent once the network is back', async () => {
        const a = api([{ kind: 'ok', card: card() }], [{ kind: 'offline' }, { kind: 'ok', card: card({ version: 2, complete: true }) }]);
        const { result } = renderHook(() => useMyIdentity('u1', a));
        await waitFor(() => expect(result.current.card?.version).toBe(1));
        await act(async () => { await result.current.save(form); });
        expect(result.current.saveState).toBe('pending');
        expect(result.current.card?.complete).toBe(false);
        expect(result.current.pending?.form).toEqual(form);
        expect(rows.get('identity:pending:u1')).toMatchObject({ body: { expectedVersion: 1 } });
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await waitFor(() => expect(result.current.saveState).toBe('saved'));
        expect(a.puts).toHaveLength(2);
        expect(result.current.card?.complete).toBe(true);
        expect(result.current.pending).toBeNull();
    });

    it('an unsent card kept from before is sent when the card opens again', async () => {
        rows.set('identity:pending:u1', { body: { expectedVersion: 1, fullName: 'Raju Bhosale' }, form, at: '2026-11-27T00:00:00Z' });
        const a = api([{ kind: 'ok', card: card() }], [{ kind: 'ok', card: card({ version: 2 }) }]);
        const { result } = renderHook(() => useMyIdentity('u1', a));
        await waitFor(() => expect(result.current.saveState).toBe('saved'));
        expect(a.puts[0]).toMatchObject({ expectedVersion: 1 });
    });

    it('409: nothing is overwritten; the server\'s newer card is read again and shown beside his edits', async () => {
        const a = api([{ kind: 'ok', card: card() }, { kind: 'ok', card: card({ version: 5, fullName: 'Raju B.' }) }], [{ kind: 'stale', currentVersion: 5 }]);
        const { result } = renderHook(() => useMyIdentity('u1', a));
        await waitFor(() => expect(result.current.card?.version).toBe(1));
        await act(async () => { await result.current.save(form); });
        expect(result.current.saveState).toBe('stale');
        expect(result.current.card?.version).toBe(5);
        expect(result.current.pending).toBeNull();
        expect(a.puts).toHaveLength(1);
    });

    it('400: the refusal is kept for the screen and the card is not sent again', async () => {
        const a = api([{ kind: 'ok', card: card() }], [{ kind: 'refused', code: 'identity.pin_invalid' }]);
        const { result } = renderHook(() => useMyIdentity('u1', a));
        await waitFor(() => expect(result.current.card?.version).toBe(1));
        await act(async () => { await result.current.save(form); });
        expect(result.current.saveState).toBe('refused');
        expect(result.current.refusedCode).toBe('identity.pin_invalid');
        await act(async () => { window.dispatchEvent(new Event('online')); });
        expect(a.puts).toHaveLength(1);
    });

    it('signed out: nothing is asked', async () => {
        const a = api([], []);
        renderHook(() => useMyIdentity(null, a));
        await new Promise(r => setTimeout(r, 20));
        expect(a.get).not.toHaveBeenCalled();
    });
});
