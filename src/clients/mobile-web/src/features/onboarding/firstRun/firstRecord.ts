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

/**
 * Task 1b (ruling 3) — after the FIRST record of a farm is saved, its saved screen offers the setup hub, once. A per-farm
 * mark on the phone: empty = not decided yet; the recording key of the farm's first record while its screen shows the
 * offer; `FIRST_RECORD_OFFER_DONE` once it was answered, or once a record that is not the farm's first was seen.
 */
export const firstRecordOfferKey = (farmId: string | null | undefined): string => `shramsafal_first_record_offer_v1:${farmId ?? 'none'}`;
export const FIRST_RECORD_OFFER_DONE = 'done';
/**
 * Task 1d (founder Q-A, 28 Nov: "Save after बरोबर") — the same mark, set when the farm's first record was saved on his
 * "बरोबर". From then on no record of the farm waits for "बरोबर"; the setup-hub line (1b) still follows that first record.
 */
export const FIRST_RECORD_SAVED = 'saved';

export type FirstRecordVerdict = 'first' | 'notFirst' | 'unknown';

/**
 * Is this recording (its records, one per plot) the farm's FIRST record on this phone? Every other record the phone holds
 * must be KNOWN to be another farm's; one with no farm on it counts as this farm's (fails closed: no offer). Not decided
 * while the recording's own records are not on the phone's list yet, or with no farm.
 */
export function firstRecordVerdict(
    logIds: readonly string[],
    history: readonly { id: string; meta?: { farmId?: string | null } }[],
    farmId: string | null | undefined,
): FirstRecordVerdict {
    if (!farmId || logIds.length === 0) return 'unknown';
    const mine = new Set(logIds);
    if (!history.some(l => mine.has(l.id))) return 'unknown';
    const another = history.some(l => !mine.has(l.id) && (!l.meta?.farmId || l.meta.farmId === farmId));
    return another ? 'notFirst' : 'first';
}
