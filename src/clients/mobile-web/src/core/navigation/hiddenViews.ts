/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — CMP-3 / H05 / P-1 / MU-21; lane CMP-D1, founder D-81)
 *
 * Which of the three home tabs a person is NOT shown, from their SEAT on the CURRENT farm.
 * Founder, 2026-10-25: "Workers do not see तुलना." Founder D-81 (2026-11): तुलना is "तुलना पाहणे", an authority like the
 * others - OFF for a co-owner / family / मुकादम until the primary owner gives it; the primary owner always has it; a
 * कामगार seat can never hold it.
 *
 * The ONE place this rule lives: the page switcher (`AppHeader` → `OversightNavCards`), the swipe between tabs
 * (`MainViewTransition`), the tab render itself (`renderCompareView`) and the लक्ष द्या card buttons all read the list this
 * returns, so a person without it cannot reach तुलना by tap, swipe or card.
 *
 * Decided from the seat's AUTHORITIES (`core/session/farmAuthorities.ts`), never from the label - a सहमालक / मुकादम label
 * grants nothing - and it FAILS CLOSED: a seat the phone does not know (no `/me/context` answer yet and nothing stored for
 * this farm, a server that sent no authorities for a non-owner) hides the tab. The primary owner is recognised by the
 * server's label (`PrimaryOwner`), as everywhere else (`holdsAuthority`). To keep the owner's tab on an offline cold start
 * the last known seat per farm is kept on the phone (`core/session/lastKnownSeats.ts`, appMeta, no Dexie bump) and the first
 * render reads it; the very first start, with nothing stored, hides it until the server has answered.
 *
 * HIDING THE TAB IS NOT THE SECURITY BOUNDARY (doctrine P9: the server decides). A person who forces the screen open still
 * gets nothing the server will not give him: the compare READ that requires SeeCompare (the primary owner always passes) is
 * lane CMP-D2. This only decides who is SHOWN the door.
 *
 * Limits (said plainly, not hidden):
 *   - this only hides the tab. The phone still receives every plot of the farm from sync - plot scope per person is
 *     PLR-D7 (CMP-4); the तुलना screen's content is frozen until lane CMP-T.
 *   - a stored seat can be stale offline (see `lastKnownSeats.ts`): a person whose authority was just taken away may still
 *     be shown the tab until the phone is online once; the server's read refuses him either way.
 */
import type { PageView } from '../../types';
import { AUTHORITY, holdsAuthority, isPrimaryAccountHolderRole } from '../session/farmAuthorities';
import type { TabSeat } from '../session/lastKnownSeats';

const NONE: readonly PageView[] = Object.freeze([]);
const COMPARE_HIDDEN: readonly PageView[] = Object.freeze(['compare'] as PageView[]);

/**
 * `seat` is the open farm's seat: `role` is the `/me/context` label ("PrimaryOwner", "Mukadam", "Worker", …) and
 * `authorities` the list the server sent. `null` / `undefined` = the phone does not know the seat.
 */
export function hiddenMainViewsFor(seat: TabSeat | null | undefined, now: Date = new Date()): readonly PageView[] {
    if (!seat) return COMPARE_HIDDEN;
    // A कामगार seat never holds it, whatever a list says (the server refuses the grant and never lists it).
    if (seat.role === 'Worker') return COMPARE_HIDDEN;
    if (isPrimaryAccountHolderRole(seat.role)) return NONE;
    const sees = holdsAuthority(
        {
            role: seat.role ?? '',
            // An authority past its end is not held - on the live seat as on the stored one (review N005); an end the
            // phone cannot read counts as ended.
            authorities: seat.authorities
                ? seat.authorities
                    .filter(a => {
                        if (!a.expiresAtUtc) return true;
                        const end = Date.parse(a.expiresAtUtc);
                        return !Number.isNaN(end) && end > now.getTime();
                    })
                    .map(a => ({ name: a.name, expiresAtUtc: a.expiresAtUtc ?? null }))
                : undefined,
        },
        AUTHORITY.seeCompare,
    );
    return sees ? NONE : COMPARE_HIDDEN;
}
