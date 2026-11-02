/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useMembershipDecisions — the PRIMARY owner's decisions about one person (approve / decline /
 * pause / restore / remove / change between the two choices), held the way `useLabourPermissions`
 * holds the labour grant:
 *
 *  - NO OPTIMISTIC MOVE. The server refuses some decisions (yourself, the registrant, the last
 *    owner, a seat whose status already moved), so the screen shows a busy state and then adopts
 *    the row the server RETURNED — never the decision it asked for.
 *  - A refusal is said plainly, in the owner's language, and the roster is read again (a refusal
 *    usually means this phone's picture is out of date).
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, AC2).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LabourPermission } from '../data/labourPermissionsClient';
import {
    approveBodyFor,
    approveMember,
    declineMember,
    membershipErrorKind,
    presetAccessBody,
    removeMember,
    restoreMember,
    setMemberAccess,
    setMemberPlotScope,
    suspendMember,
    plotScopeBody,
    type ApprovePreset,
    type MembershipErrorKind,
    type PlotScopeChoice,
} from '../data/membershipAdminClient';
import { TEAM_COPY } from '../team/teamCopy';

const MESSAGE: Record<MembershipErrorKind, string> = {
    last_owner: TEAM_COPY.lastOwner,
    wrong_status: TEAM_COPY.wrongStatus,
    forbidden: TEAM_COPY.forbidden,
    failed: TEAM_COPY.failed,
};

export interface MembershipDecisionError {
    userId: string;
    message: string;
}

export interface UseMembershipDecisionsResult {
    /** The person whose decision is in flight, if any (one at a time). */
    busyUserId: string | null;
    error: MembershipDecisionError | null;
    /** lane MU-4 — `plots`: the plots chosen in the same tap (absent = the server's default, every plot). */
    approve: (userId: string, preset: ApprovePreset, plots?: PlotScopeChoice) => Promise<boolean>;
    /** lane MU-4 — which plots a let-in person covers (DESIRED state; the server's row is adopted). */
    setPlots: (userId: string, plots: PlotScopeChoice) => Promise<boolean>;
    decline: (userId: string, reason?: string) => Promise<boolean>;
    suspend: (userId: string, reason?: string) => Promise<boolean>;
    restore: (userId: string) => Promise<boolean>;
    remove: (userId: string, reason?: string) => Promise<boolean>;
    /**
     * Move a let-in person to the other choice, in ONE request: the new role starts from its own
     * defaults (nothing stored for the old role comes along), and the हजेरी व पक्कं grant follows
     * the choice — on for काम + हजेरी, off for काम सांगणे.
     */
    changePreset: (row: LabourPermission, preset: ApprovePreset) => Promise<boolean>;
    dismissError: () => void;
}

export function useMembershipDecisions(
    farmId: string | null | undefined,
    adoptRow: (row: LabourPermission) => void,
    reload: () => Promise<void>,
): UseMembershipDecisionsResult {
    const [busyUserId, setBusyUserId] = useState<string | null>(null);
    const [error, setError] = useState<MembershipDecisionError | null>(null);
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    /** Runs one decision; adopts every row the server returns; `true` only when it landed. */
    const run = useCallback(async (
        userId: string,
        calls: (farm: string) => Promise<LabourPermission[]>,
    ): Promise<boolean> => {
        if (!farmId) return false;
        setBusyUserId(userId);
        setError(null);
        try {
            const rows = await calls(farmId);
            if (!mountedRef.current) return false;
            rows.forEach(adoptRow);
            return true;
        } catch (caught) {
            if (!mountedRef.current) return false;
            setError({ userId, message: MESSAGE[membershipErrorKind(caught)] });
            await reload();
            return false;
        } finally {
            if (mountedRef.current) setBusyUserId(null);
        }
    }, [farmId, adoptRow, reload]);

    const approve = useCallback((userId: string, preset: ApprovePreset, plots?: PlotScopeChoice) =>
        run(userId, async farm => [await approveMember(farm, userId, { ...approveBodyFor(preset), ...(plots ? plotScopeBody(plots) : {}) })]),
    [run]);

    const setPlots = useCallback((userId: string, plots: PlotScopeChoice) =>
        run(userId, async farm => [await setMemberPlotScope(farm, userId, plots)]), [run]);

    const decline = useCallback((userId: string, reason?: string) =>
        run(userId, async farm => [await declineMember(farm, userId, reason)]), [run]);

    const suspend = useCallback((userId: string, reason?: string) =>
        run(userId, async farm => [await suspendMember(farm, userId, reason)]), [run]);

    const restore = useCallback((userId: string) =>
        run(userId, async farm => [await restoreMember(farm, userId)]), [run]);

    const remove = useCallback((userId: string, reason?: string) =>
        run(userId, async farm => [await removeMember(farm, userId, reason)]), [run]);

    const changePreset = useCallback((row: LabourPermission, preset: ApprovePreset) =>
        run(row.userId, async farm => [await setMemberAccess(farm, row.userId, presetAccessBody(preset))]),
    [run]);

    const dismissError = useCallback(() => setError(null), []);

    return { busyUserId, error, approve, setPlots, decline, suspend, restore, remove, changePreset, dismissError };
}
