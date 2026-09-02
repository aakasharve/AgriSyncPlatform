/**
 * useLabourPermissions tests — LABOUR_PHASE2 Phase 5, the UI half.
 *
 * @vitest-environment jsdom
 *
 * THE PROPERTY UNDER TEST IS "THE SWITCH DOES NOT LIE".
 *
 * `TeamMemberCard`'s existing capability switches move on tap, keep the change
 * in local state, reach no server, and are overwritten by the next pull. This
 * hook exists so the labour switch cannot do that — so the assertions that
 * matter most here are the NEGATIVE ones: it does not move optimistically, it
 * does not fall back to a local roster when the read fails, and it does not
 * write back the boolean it asked for.
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockFetch = vi.fn();
const mockSet = vi.fn();
vi.mock('../data/labourPermissionsClient', async (importOriginal) => {
    // `isCarriedByRoleError` is REAL — it is part of what is under test here,
    // and stubbing it would let a wrong error message pass unnoticed.
    const actual = await importOriginal<typeof import('../data/labourPermissionsClient')>();
    return {
        ...actual,
        fetchLabourPermissions: (...args: unknown[]) => mockFetch(...args),
        setLabourPermission: (...args: unknown[]) => mockSet(...args),
    };
});

import { useLabourPermissions, LABOUR_PERMISSION_MESSAGES } from '../hooks/useLabourPermissions';
import {
    LABOUR_CAPABILITY_CARRIED_BY_ROLE,
    type LabourPermission,
} from '../data/labourPermissionsClient';

const worker = (over: Partial<LabourPermission> = {}): LabourPermission => ({
    userId: 'user-worker', role: 'Worker', status: 'Active',
    canManageLabourRecords: false, hasExplicitGrant: false,
    source: 'NotGranted', isGrantEditable: true,
    labourGrantExpiresAtUtc: null,
    ...over,
});

const mukadam = (): LabourPermission => ({
    userId: 'user-mukadam', role: 'Mukadam', status: 'Active',
    canManageLabourRecords: false, hasExplicitGrant: false,
    source: 'NotGranted', isGrantEditable: true,
    labourGrantExpiresAtUtc: null,
});

const roster = () => [mukadam(), worker()];

beforeEach(() => {
    mockFetch.mockReset();
    mockSet.mockReset();
});

describe('reading the roster', () => {
    it('reads the SERVER roster for the farm', async () => {
        mockFetch.mockResolvedValue(roster());

        const { result } = renderHook(() => useLabourPermissions('farm-123'));

        await waitFor(() => expect(result.current.rows).not.toBeNull());
        expect(mockFetch).toHaveBeenCalledWith('farm-123');
        expect(result.current.rows).toHaveLength(2);
    });

    it('asks nothing until a farm is resolved', async () => {
        const { result } = renderHook(() => useLabourPermissions(null));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(mockFetch).not.toHaveBeenCalled();
        // `null`, not `[]`. "We have not asked" is a different statement from
        // "this farm has no members", and an empty roster would render as the
        // second.
        expect(result.current.rows).toBeNull();
    });

    it('stays null on a failed read — it never falls back to a local roster', async () => {
        // The trap this closes: `profile.operators[].id` is a LOCAL profile id.
        // Substituting the profile here would address every PUT to a user the
        // server has never heard of.
        mockFetch.mockRejectedValue(new Error('offline'));

        const { result } = renderHook(() => useLabourPermissions('farm-123'));

        await waitFor(() => expect(result.current.loadFailed).toBe(true));
        expect(result.current.rows).toBeNull();
    });

    it('re-reads when the farm changes', async () => {
        mockFetch.mockResolvedValue(roster());

        const { result, rerender } = renderHook(
            ({ farmId }) => useLabourPermissions(farmId),
            { initialProps: { farmId: 'farm-a' } },
        );
        await waitFor(() => expect(result.current.rows).not.toBeNull());

        rerender({ farmId: 'farm-b' });
        await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('farm-b'));
    });
});

describe('changing a permission', () => {
    it('sends the DESIRED state and adopts the row the server returns', async () => {
        mockFetch.mockResolvedValue(roster());
        const granted = worker({
            canManageLabourRecords: true, hasExplicitGrant: true, source: 'ExplicitGrant',
        });
        mockSet.mockResolvedValue(granted);

        const { result } = renderHook(() => useLabourPermissions('farm-123'));
        await waitFor(() => expect(result.current.rows).not.toBeNull());

        await act(async () => { await result.current.setPermission('user-worker', true); });

        expect(mockSet).toHaveBeenCalledWith('farm-123', 'user-worker', true, null);
        // Adopted WHOLE — `source` moved to ExplicitGrant, which only the
        // server could have decided.
        expect(result.current.rows?.find(r => r.userId === 'user-worker')).toEqual(granted);
    });

    it('leaves every other member untouched', async () => {
        mockFetch.mockResolvedValue(roster());
        mockSet.mockResolvedValue(worker({ canManageLabourRecords: true }));

        const { result } = renderHook(() => useLabourPermissions('farm-123'));
        await waitFor(() => expect(result.current.rows).not.toBeNull());

        await act(async () => { await result.current.setPermission('user-worker', true); });

        expect(result.current.rows?.find(r => r.userId === 'user-mukadam')).toEqual(mukadam());
    });

    it('does NOT move the switch optimistically', async () => {
        // The heart of it. An optimistic flip that later springs back is
        // indistinguishable from the mock this work replaces: it moves, and
        // nothing happens (`P5`). The switch stays where the server put it and
        // reports itself busy instead.
        mockFetch.mockResolvedValue(roster());
        let release: (value: LabourPermission) => void = () => { };
        mockSet.mockImplementation(() => new Promise<LabourPermission>(resolve => { release = resolve; }));

        const { result } = renderHook(() => useLabourPermissions('farm-123'));
        await waitFor(() => expect(result.current.rows).not.toBeNull());

        act(() => { void result.current.setPermission('user-worker', true); });

        await waitFor(() => expect(result.current.savingUserId).toBe('user-worker'));
        // Still OFF while the write is in flight.
        expect(result.current.rows?.find(r => r.userId === 'user-worker')?.canManageLabourRecords)
            .toBe(false);

        await act(async () => { release(worker({ canManageLabourRecords: true })); });
        await waitFor(() => expect(result.current.savingUserId).toBeNull());
        expect(result.current.rows?.find(r => r.userId === 'user-worker')?.canManageLabourRecords)
            .toBe(true);
    });

    it('names the ROLE reason when the server refuses with 409', async () => {
        mockFetch.mockResolvedValue(roster());
        mockSet.mockRejectedValue({
            response: { status: 409, data: { error: LABOUR_CAPABILITY_CARRIED_BY_ROLE } },
        });

        const { result } = renderHook(() => useLabourPermissions('farm-123'));
        await waitFor(() => expect(result.current.rows).not.toBeNull());

        await act(async () => { await result.current.setPermission('user-mukadam', false); });

        expect(result.current.error).toBe(LABOUR_PERMISSION_MESSAGES.carriedByRole);
    });

    it('does not dress a 403 up as the role reason', async () => {
        // 403 covers "not an owner", "self-target", "not a member" and "unknown
        // farm", all with an empty body. Telling an owner "they have it through
        // their role" would be an explanation he cannot act on.
        mockFetch.mockResolvedValue(roster());
        mockSet.mockRejectedValue({ response: { status: 403, data: '' } });

        const { result } = renderHook(() => useLabourPermissions('farm-123'));
        await waitFor(() => expect(result.current.rows).not.toBeNull());

        await act(async () => { await result.current.setPermission('user-worker', true); });

        expect(result.current.error).toBe(LABOUR_PERMISSION_MESSAGES.changeFailed);
    });

    it('leaves the switch where the server has it after a refusal', async () => {
        mockFetch.mockResolvedValue(roster());
        mockSet.mockRejectedValue({ response: { status: 403, data: '' } });

        const { result } = renderHook(() => useLabourPermissions('farm-123'));
        await waitFor(() => expect(result.current.rows).not.toBeNull());

        await act(async () => { await result.current.setPermission('user-worker', true); });

        expect(result.current.rows?.find(r => r.userId === 'user-worker')?.canManageLabourRecords)
            .toBe(false);
        expect(result.current.savingUserId).toBeNull();
    });

    it('re-reads after a refusal, because our picture may be stale', async () => {
        mockFetch.mockResolvedValue(roster());
        mockSet.mockRejectedValue({ response: { status: 403, data: '' } });

        const { result } = renderHook(() => useLabourPermissions('farm-123'));
        await waitFor(() => expect(result.current.rows).not.toBeNull());
        const readsBefore = mockFetch.mock.calls.length;

        await act(async () => { await result.current.setPermission('user-worker', true); });

        expect(mockFetch.mock.calls.length).toBeGreaterThan(readsBefore);
    });

    it('writes nothing when no farm is resolved', async () => {
        const { result } = renderHook(() => useLabourPermissions(undefined));

        await act(async () => { await result.current.setPermission('user-worker', true); });

        expect(mockSet).not.toHaveBeenCalled();
    });

    it('clears the message when asked', async () => {
        mockFetch.mockResolvedValue(roster());
        mockSet.mockRejectedValue({ response: { status: 403, data: '' } });

        const { result } = renderHook(() => useLabourPermissions('farm-123'));
        await waitFor(() => expect(result.current.rows).not.toBeNull());
        await act(async () => { await result.current.setPermission('user-worker', true); });
        expect(result.current.error).not.toBeNull();

        act(() => { result.current.dismissError(); });
        expect(result.current.error).toBeNull();
    });
});

describe('the copy this hook hands the UI', () => {
    it('is English, because no Marathi has been approved for it', () => {
        // Recorded deliberately, and on the founder-copy list. No agent in this
        // phase has invented farmer-facing Marathi and none may start here.
        for (const message of Object.values(LABOUR_PERMISSION_MESSAGES)) {
            expect(/[ऀ-ॿ]/.test(message)).toBe(false);
        }
    });
});
