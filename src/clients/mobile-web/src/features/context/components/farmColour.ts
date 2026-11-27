/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 - repair R3, lane S1 (V3-D, CTO ruling 1). Each farm has its own colour, so a
 * person who works on two or three farms sees at a glance which one is open: the header's bottom edge, the "तुम्ही इथे" card, the
 * switcher's rows and the "आता: ‹शेत›" note all carry it.
 *
 * THE RULE
 *  - A fixed palette of eight clear colours (the ruling's order).
 *  - A farm's colour = palette[hash(farm id) mod 8], so the same farm has the same colour on every phone, for everyone on it.
 *    The hash is 32-bit FNV-1a over the id trimmed and in lower case (two server reads of one farm may differ in letter case).
 *  - When two of ONE person's farms land on the same colour, the farm whose id sorts later takes the next free colour (and so on
 *    round the palette). A ninth farm has no free colour left and keeps its own.
 *  - Phone only: no server field. Changing the hash recolours every farm at once, so `farmColour.test.ts` pins it.
 */

export interface FarmColour {
    /** A plain name, for tests and the report. */
    name: 'green' | 'blue' | 'brown' | 'purple' | 'teal' | 'indigo' | 'olive' | 'slate';
    /** The strong colour: strips, the label, the pill and the note (white text reads on it). */
    ink: string;
    /** The light tint of the same colour: the card's and the current row's ground. */
    tint: string;
}

export const FARM_PALETTE: readonly FarmColour[] = [
    { name: 'green', ink: '#047857', tint: '#ECFDF5' },
    { name: 'blue', ink: '#1D4ED8', tint: '#EFF6FF' },
    { name: 'brown', ink: '#B45309', tint: '#FFF7ED' },
    { name: 'purple', ink: '#6D28D9', tint: '#F5F3FF' },
    { name: 'teal', ink: '#0F766E', tint: '#F0FDFA' },
    { name: 'indigo', ink: '#4338CA', tint: '#EEF2FF' },
    { name: 'olive', ink: '#4D7C0F', tint: '#F7FEE7' },
    // slate's own lightest tint is nearly white on the white header; one step darker still reads as a tint.
    { name: 'slate', ink: '#475569', tint: '#F1F5F9' },
];

const normalise = (farmId: string): string => farmId.trim().toLowerCase();

/** 32-bit FNV-1a: small, fixed and the same in every JavaScript engine. */
function fnv1a(text: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/** The palette place a farm's id points to, before any clash with the person's other farms. */
export function farmColourIndex(farmId: string): number {
    return fnv1a(normalise(farmId)) % FARM_PALETTE.length;
}

/**
 * The colours of one person's farms: give it every farm id he holds, get back the colour of any farm. Ids are taken in sorted
 * order (plain code-unit order, the same on every phone), so on a clash the earlier id keeps its colour and the later one moves
 * on. An id that was not in the list reads its own colour.
 */
export function farmColoursFor(farmIds: Iterable<string>): (farmId: string) => FarmColour {
    const ids = [...new Set([...farmIds].map(normalise))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const taken = new Set<number>();
    const placed = new Map<string, number>();
    for (const id of ids) {
        const own = fnv1a(id) % FARM_PALETTE.length;
        let at = own;
        for (let step = 0; step < FARM_PALETTE.length && taken.has(at); step++) at = (at + 1) % FARM_PALETTE.length;
        if (taken.has(at)) at = own; // all eight are taken: there is no free colour left
        taken.add(at);
        placed.set(id, at);
    }
    return (farmId: string) => FARM_PALETTE[placed.get(normalise(farmId)) ?? farmColourIndex(farmId)]!;
}
