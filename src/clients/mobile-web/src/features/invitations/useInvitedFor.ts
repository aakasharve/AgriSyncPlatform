/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane MU-1 (MU-2 review N-6). When a personal invitation is opened by someone other than the person it named,
 * the owner decides on that claimant's own request card - and that card must say "this invitation was for ‹name · …2345›",
 * not only show the claimant's name and last four digits. The server already knows (`claimedByAnotherNumber` on the sent list);
 * this reads that list once and returns, per invitation id, who it was for - only for a claim by another number.
 * A list that cannot be read gives no line (never a guessed one) and leaves a trace.
 */
import { useEffect, useState } from 'react';
import { listInvitations } from './personalInvitationClient';

/** invitation id -> "रमेश · …2345" for every claim made by another number. */
export function useInvitedFor(farmId: string | null | undefined, refreshKey: number = 0): ReadonlyMap<string, string> {
    const [map, setMap] = useState<ReadonlyMap<string, string>>(new Map());
    useEffect(() => {
        if (!farmId) {
            setMap(new Map());
            return;
        }
        let live = true;
        listInvitations(farmId)
            .then(rows => {
                if (!live) return;
                const next = new Map<string, string>();
                for (const row of rows) {
                    if (row.claimedByAnotherNumber !== true) continue;
                    const who = [row.name?.trim(), row.invitedPhoneLast4 ? `…${row.invitedPhoneLast4}` : '']
                        .filter(Boolean)
                        .join(' · ');
                    if (who) next.set(row.id, who);
                }
                setMap(next);
            })
            .catch((error: unknown) => {
                // Landing place: the console trace. No line is drawn (never a guessed "who it was for").
                console.warn('[invitations] the sent list could not be read for the request card', error);
                if (live) setMap(new Map());
            });
        return () => { live = false; };
    }, [farmId, refreshKey]);
    return map;
}
