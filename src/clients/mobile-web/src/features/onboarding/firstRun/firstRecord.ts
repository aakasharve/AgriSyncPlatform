/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1 (founder Q5 = Option A, 28 Nov; CTO rulings 1-3).
 * The facts the first-record card rests on, pure so each is tested alone.
 *
 * The card has its OWN once-only key. It is written `false` ("due") when an owner seat leaves the role welcome ("चला,
 * सुरुवात करूया") and `true` when he answers it. A phone with NO row passed the first run before the card existed: the
 * fallback reads "seen", so an installed phone never sees it (P11) and a failed read fails closed.
 */
import { toWelcomeRole } from './roleWelcome';

export const FIRST_RECORD_CARD_KEY = 'shramsafal_first_record_card_v1_seen';

/** No row = an installed phone that passed the first run long ago: nothing to show (P11, fail closed). */
export const FIRST_RECORD_CARD_FALLBACK = true;

/** Ruling 1: "the farm owner" — an owner or a co-owner seat. A worker, a मुकादम or an adviser lands where he lands today. */
export function mayOfferFirstRecord(role: string | null | undefined): boolean {
    const kind = toWelcomeRole(role);
    return kind === 'owner' || kind === 'coOwner';
}
