/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, H10 / H-13; I12-V1-M2) — may the work home
 * show the "आजची हजेरी" door to THIS person, now?
 *
 *   - owner tier (PrimaryOwner / SecondaryOwner, the server-told role): yes;
 *   - a worker, or a role the server has not told this phone yet: no;
 *   - anyone else (a मुकादम…): only with the owner's labour grant, as the SERVER answers it.
 *
 * Before I12-V1-M2 that answer came only from the read-out the हजेरी screen caches, so a मुकादम on a
 * fresh phone never saw the door until he had found हजेरी some other way. Now, when the आजची कामे tab
 * opens online, this asks the server for the (smallest, today-only) labour read-out and caches it
 * exactly as the हजेरी screen does (money stripped, `saveLabourReadout`). The door stays HIDDEN while
 * the answer is unknown; an unreachable server is "unknown", never "no"; a 403 (no longer a member)
 * erases the cached copies the same way `useLabourState` does. Asked at most once per
 * `HOME_GRANT_REASK_MS` for the same person and farm; the cached answer is re-read every time the tab
 * opens (the हजेरी screen refreshes it).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOptionalAuth } from '../../app/providers/AuthProvider';
import { isFarmAccessRefused, purgeLabourCachesForFarm } from '../../infrastructure/storage/labourFarmAccess';
import { isOwnerTierRole } from '../profile/helpers/teamRoster';
import { fetchLabourData } from './data/labourClient';
import { saveLabourReadout } from './data/labourReadout';
import { isWorkerRole, readCachedLabourGrant } from './homeAttendanceDoor';
import type { LabourWindow } from './labourWindow';

/** The smallest read-out: enough to learn the grant. */
export const HOME_GRANT_WINDOW: LabourWindow = 'today';
/** Ask the server again at most this often for the same person and farm. */
export const HOME_GRANT_REASK_MS = 5 * 60 * 1000;

export interface HomeAttendanceDoorInput {
    /** The server-told role on the current farm (/me/context). */
    role: string | null | undefined;
    /** Used only when there is no signed-in session to read it from (tests, preview shells). */
    userId: string | null | undefined;
    farmId: string | null | undefined;
    /** The आजची कामे tab is on screen (route 'main', view 'log'). */
    active: boolean;
}

export function useHomeAttendanceDoor({ role, userId: userIdIn, farmId, active }: HomeAttendanceDoorInput): boolean {
    const auth = useOptionalAuth();
    // The read-out cache is keyed by the SESSION's user id (as `useLabourState` writes it).
    const userId = auth?.session?.userId ?? userIdIn ?? null;
    // No AuthProvider above (tests, preview shells): nothing to wait for.
    const hasToken = auth === null || Boolean(auth.session?.accessToken);
    const ownerTier = isOwnerTierRole(role);
    const mustAsk = active && !ownerTier && !!role && !isWorkerRole(role) && !!userId && !!farmId;
    const key = `${userId ?? ''}|${farmId ?? ''}`;

    // The server's last cached answer, re-read each time the tab opens.
    const cached = useMemo(() => (mustAsk ? readCachedLabourGrant(userId, farmId) : undefined), [mustAsk, userId, farmId]);
    // The answer this hook just fetched (and cached), while the tab stays open.
    const [fresh, setFresh] = useState<{ key: string; grant: boolean | undefined } | null>(null);
    // One ask per person+farm at a time, SHARED by every run of the effect below — so a StrictMode
    // double-invoke (or a quick tab switch) joins the request in flight instead of losing its answer.
    const asks = useRef(new Map<string, { at: number; answer: Promise<void> }>());

    useEffect(() => {
        if (!mustAsk || !hasToken || !userId || !farmId) return undefined;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined;
        let ask = asks.current.get(key);
        if (!ask || Date.now() - ask.at >= HOME_GRANT_REASK_MS) {
            const answer = fetchLabourData(farmId, HOME_GRANT_WINDOW).then(
                (data) => { saveLabourReadout(userId, farmId, HOME_GRANT_WINDOW, data); },
                (err: unknown) => {
                    if (isFarmAccessRefused(err)) {
                        // The server READ the request and said "not a member": nothing cached stays.
                        purgeLabourCachesForFarm(userId, farmId);
                        return;
                    }
                    // Unreachable / 5xx: unknown, not "no" — keep the cached answer, ask again next time.
                    asks.current.delete(key);
                },
            );
            ask = { at: Date.now(), answer };
            asks.current.set(key, ask);
        }
        let cancelled = false;
        void ask.answer.then(() => { if (!cancelled) setFresh({ key, grant: readCachedLabourGrant(userId, farmId) }); });
        return () => { cancelled = true; setFresh(null); };
    }, [mustAsk, hasToken, userId, farmId, key]);

    if (ownerTier) return true;
    if (!mustAsk) return false;
    const grant = fresh && fresh.key === key ? fresh.grant : cached;
    return grant === true;
}

export default useHomeAttendanceDoor;
