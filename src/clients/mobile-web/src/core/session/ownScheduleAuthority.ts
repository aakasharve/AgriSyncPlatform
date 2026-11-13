/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 1; founder D-88 = 2, doctrine P5, P9, P10) - who is SHOWN the own-schedule maker.
 *
 * The owner and the people holding "पीक वेळापत्रकाचे नमुने" (`ScheduleTemplates`) on the open farm make and change a person's own schedule; the server asks
 * again on every write (`OwnScheduleGate`), so hiding the door is presentation, not the security boundary. A seat without the authority sees no maker
 * and no library controls - NOTHING GREYED. Decided from the seat's AUTHORITIES (`farmAuthorities.ts`), never from a label, exactly the way the तुलना
 * tab is decided (`core/navigation/hiddenViews.ts`, CMP-D1), and it FAILS CLOSED: a seat the phone does not know (no `/me/context` answer yet and no last
 * known seat for this farm, a server that sent no list for a non-owner) shows nothing. The caller hands the seat `useSeatForTabs` gives (live, else the
 * last known one of this user on this farm). A grant that has ended - or whose end the phone cannot read - is not held.
 */
import { AUTHORITY, holdsAuthority, isPrimaryAccountHolderRole } from './farmAuthorities';
import type { TabSeat } from './lastKnownSeats';

export function mayMakeOwnSchedule(seat: TabSeat | null | undefined, now: Date = new Date()): boolean {
    if (!seat) return false;
    if (isPrimaryAccountHolderRole(seat.role)) return true;
    return holdsAuthority(
        {
            role: seat.role ?? '',
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
        AUTHORITY.scheduleTemplates,
    );
}
