/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (MU design §6, "role-shaped capability, same shell"). Which
 * doors this seat is shown, read from the authorities the server sent - never from the label (D-22, D-26): owner full, मुकादम
 * short, worker minimal. Hiding is presentation only: the server already protects the data (G1/G2), and still answers every
 * request. A worker's bar used to show खरेदी / उत्पन्न / चाचण्या, and उत्पन्न led to a page that (rightly) said "श्रमसफलच्या
 * नियमानुसार पैशांचा हिशोब इथे दिसत नाही." - a door he cannot use is not drawn.
 *
 * When the phone does NOT know the seat (no farm context yet: the first seconds of a start, or an offline cold start) every
 * door is shown, as before: failing closed here would take the doors away from every owner on every offline start, and the
 * server decides anyway. A KNOWN seat that the server did not describe with authorities (an older server) keeps only the
 * primary account holder's doors - the same rule `holdsAuthority` has.
 */
import { AUTHORITY, holdsAuthority } from './farmAuthorities';
import type { MeFarm } from './MeContextService';

export interface SeatDoors {
    /** खरेदी - purchases and the money behind them. */
    procurement: boolean;
    /** उत्पन्न and पैसे व हिशोब - the farm's money. */
    money: boolean;
    /** चाचण्या - lab and test records. */
    tests: boolean;
}

const ALL: SeatDoors = Object.freeze({ procurement: true, money: true, tests: true });

type SeatLike = Pick<MeFarm, 'role' | 'authorities'>;

export function seatDoors(farm: SeatLike | null | undefined): SeatDoors {
    if (!farm) return ALL;
    const sees = holdsAuthority(farm, AUTHORITY.seeMoney);
    return {
        // A purchase is money in; it is drawn for a seat that sees or reviews the farm's money.
        procurement: sees || holdsAuthority(farm, AUTHORITY.reviewMoney),
        money: sees,
        tests: holdsAuthority(farm, AUTHORITY.labRecords),
    };
}
