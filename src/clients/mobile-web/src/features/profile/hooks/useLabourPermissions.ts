/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useLabourPermissions — the server's answer to "who may fix labour here",
 * held in one place so the switch that renders it cannot invent its own.
 *
 * ── NO OPTIMISTIC FLIP. THIS IS THE WHOLE POINT. ─────────────────────────────
 * The obvious ergonomic choice — move the switch immediately, reconcile later —
 * would re-create the exact defect this work exists to remove. The server
 * legitimately REFUSES some writes (403 for a non-owner or a self-target, 409
 * when the target's role already carries the capability), so an optimistic flip
 * would show the owner a switch that moved and then silently sprang back. That
 * is indistinguishable from today's mock, which also moves and also changes
 * nothing (`P5`).
 *
 * So the switch stays where the SERVER last put it, shows a busy state while
 * the write is in flight, and adopts the row the server returns. It moves when
 * it has actually moved, and not before.
 *
 * ── THE RESPONSE IS THE TRUTH, NOT THE REQUEST ───────────────────────────────
 * `setPermission` adopts the returned row wholesale rather than writing back
 * the boolean it asked for. `source` and `isGrantEditable` can only be
 * recomputed server-side; assuming the request landed would leave the UI
 * displaying rules it had stopped tracking.
 *
 * ── DESIRED STATE, SO A RETRY CONVERGES ──────────────────────────────────────
 * The caller says what it wants to be true, never "flip". A farmer on a rural
 * connection who taps, loses signal and taps again lands on the state he chose
 * rather than oscillating.
 *
 * @module features/profile/hooks/useLabourPermissions
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
    fetchLabourPermissions,
    isCarriedByRoleError,
    setLabourPermission,
    type LabourPermission,
} from '../data/labourPermissionsClient';

/**
 * FARMER-FACING COPY, ENGLISH ONLY, AND DELIBERATELY SO.
 *
 * No approved Marathi exists for these two situations. Every implementer in
 * this phase has held the line that agents do not invent farmer-facing Marathi,
 * so these stay English and are on the founder-copy list. Do not "translate"
 * them here.
 */
export const LABOUR_PERMISSION_MESSAGES = {
    /** 409 — the member's ROLE already carries the capability. */
    carriedByRole: 'This member already has it through their role — it cannot be switched off.',
    /** Anything else: 403, network down, server error. */
    changeFailed: 'Could not change this. Try again.',
    loadFailed: 'Could not load who may fix labour records.',
} as const;

export interface UseLabourPermissionsResult {
    /** `null` until the first read resolves — NOT an empty roster. */
    rows: LabourPermission[] | null;
    loading: boolean;
    /** The read failed. The caller must not substitute the local profile. */
    loadFailed: boolean;
    /** The member whose write is in flight, if any. */
    savingUserId: string | null;
    /** English, from `LABOUR_PERMISSION_MESSAGES`. `null` when nothing is wrong. */
    error: string | null;
    reload: () => Promise<void>;
    /**
     * Desired state, not a toggle. `labourGrantExpiresAtUtc` is the ISO instant
     * the responsibility ends (R1 Task 2.2); omitted/null = कायम, no end date.
     */
    setPermission: (
        targetUserId: string,
        canManageLabourRecords: boolean,
        labourGrantExpiresAtUtc?: string | null,
    ) => Promise<void>;
    dismissError: () => void;
}

export function useLabourPermissions(farmId: string | null | undefined): UseLabourPermissionsResult {
    const [rows, setRows] = useState<LabourPermission[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [savingUserId, setSavingUserId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Guards every setState after an await. Without it, switching farms (or
    // unmounting the profile screen) while a read is in flight writes one
    // farm's roster into another farm's screen — and this screen hands out
    // authority, so showing the wrong farm's members is not a cosmetic bug.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const load = useCallback(async () => {
        if (!farmId) {
            // No farm resolved yet. Make NO claim — an empty roster would read
            // as "this farm has no members", which is a different statement
            // from "we have not asked yet".
            setRows(null);
            setLoadFailed(false);
            return;
        }

        setLoading(true);
        setLoadFailed(false);
        try {
            const next = await fetchLabourPermissions(farmId);
            if (!mountedRef.current) return;
            setRows(next);
        } catch {
            if (!mountedRef.current) return;
            // Stay `null`. Falling back to the local profile here is precisely
            // how a PUT ends up addressed to a profile id the server has never
            // seen — `profile.operators[].id` is not a server `userId`.
            setRows(null);
            setLoadFailed(true);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [farmId]);

    useEffect(() => { void load(); }, [load]);

    const setPermission = useCallback(async (
        targetUserId: string,
        canManageLabourRecords: boolean,
        labourGrantExpiresAtUtc?: string | null,
    ) => {
        if (!farmId) return;

        setSavingUserId(targetUserId);
        setError(null);
        try {
            const updated = await setLabourPermission(
                farmId, targetUserId, canManageLabourRecords, labourGrantExpiresAtUtc ?? null);
            if (!mountedRef.current) return;
            // Adopt the SERVER's row, whole. Not the boolean we asked for.
            setRows(current => (current ?? []).map(
                row => (row.userId === updated.userId ? updated : row),
            ));
        } catch (caught) {
            if (!mountedRef.current) return;
            setError(isCarriedByRoleError(caught)
                ? LABOUR_PERMISSION_MESSAGES.carriedByRole
                : LABOUR_PERMISSION_MESSAGES.changeFailed);
            // The switch has NOT moved, because nothing optimistic moved it.
            // Re-read anyway: a refusal often means this client's picture of
            // who may edit what is already out of date.
            await load();
        } finally {
            if (mountedRef.current) setSavingUserId(null);
        }
    }, [farmId, load]);

    const dismissError = useCallback(() => setError(null), []);

    return {
        rows,
        loading,
        loadFailed,
        savingUserId,
        error,
        reload: load,
        setPermission,
        dismissError,
    };
}
