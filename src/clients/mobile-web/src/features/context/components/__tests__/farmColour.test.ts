/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 - repair R3, lane S1 (V3-D, CTO ruling 1). A farm's colour: a fixed palette of
 * eight clear colours; palette[stable hash of the farm id mod 8], so the same farm has the same colour for everyone; when two of one
 * person's farms land on the same colour, the farm with the later id (sorted) takes the next free colour. Phone only.
 *
 * The pinned ids below are fixed on purpose: a change to the hash would recolour every farm on every phone at once.
 */
import { describe, expect, it } from 'vitest';
import { FARM_PALETTE, farmColourIndex, farmColoursFor } from '../farmColour';

const INKS = ['#047857', '#1D4ED8', '#B45309', '#6D28D9', '#0F766E', '#4338CA', '#4D7C0F', '#475569'];
const GREEN = '#047857';
const BLUE = '#1D4ED8';
const BROWN = '#B45309';
const INDIGO = '#4338CA';
const SLATE = '#475569';

/** WCAG relative luminance and contrast, computed here (not borrowed from the module under test). */
const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

describe('the farm palette (CTO ruling 1)', () => {
    it('is the ruling\'s eight colours, in its order: green, blue, brown, purple, teal, indigo, olive, slate', () => {
        expect(FARM_PALETTE.map(c => c.ink)).toEqual(INKS);
        expect(FARM_PALETTE.map(c => c.name)).toEqual(['green', 'blue', 'brown', 'purple', 'teal', 'indigo', 'olive', 'slate']);
    });

    it('the design\'s own tints for green, blue and brown', () => {
        expect(FARM_PALETTE[0]!.tint).toBe('#ECFDF5');
        expect(FARM_PALETTE[1]!.tint).toBe('#EFF6FF');
        expect(FARM_PALETTE[2]!.tint).toBe('#FFF7ED');
    });

    it('every colour is readable: white on the ink (the pill, the note), and the ink on its own light tint (the label)', () => {
        for (const c of FARM_PALETTE) {
            expect(contrast('#FFFFFF', c.ink), `white on ${c.name}`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(c.ink, c.tint), `${c.name} on its tint`).toBeGreaterThanOrEqual(4.5);
            expect(luminance(c.tint), `${c.name}'s tint is light`).toBeGreaterThan(0.85);
        }
    });
});

describe('one farm, one colour, for everyone', () => {
    it('pins the colour of a farm id (FNV-1a of the id, mod 8)', () => {
        expect(farmColourIndex('3f2b8c1e-7d4a-4e9b-9c2f-1a2b3c4d5e6f')).toBe(1);
        expect(farmColourIndex('8d1e6f0a-2b3c-4d5e-8f9a-0b1c2d3e4f5a')).toBe(0);
        expect(farmColourIndex('c0ffee00-1111-4222-8333-444455556666')).toBe(7);
        expect(farmColourIndex('farm-1')).toBe(7);
        expect(farmColourIndex('farm-2')).toBe(2);
        expect(farmColourIndex('farm-3')).toBe(5);
    });

    it('ignores letter case and spaces round the id: the same farm from two server reads is the same colour', () => {
        expect(farmColourIndex('3F2B8C1E-7D4A-4E9B-9C2F-1A2B3C4D5E6F')).toBe(1);
        expect(farmColourIndex(' 3f2b8c1e-7d4a-4e9b-9c2f-1a2b3c4d5e6f ')).toBe(1);
        expect(farmColoursFor(['3f2b8c1e-7d4a-4e9b-9c2f-1a2b3c4d5e6f'])('3F2B8C1E-7D4A-4E9B-9C2F-1A2B3C4D5E6F').ink).toBe(BLUE);
    });

    it('a farm alone, or three farms that do not clash, each keep their own colour', () => {
        expect(farmColoursFor(['farm-2'])('farm-2').ink).toBe(BROWN);
        const of = farmColoursFor(['farm-1', 'farm-2', 'farm-3']);
        expect([of('farm-1').ink, of('farm-2').ink, of('farm-3').ink]).toEqual([SLATE, BROWN, INDIGO]);
    });

    it('an id the list did not hold reads its own colour, never nothing', () => {
        expect(farmColoursFor(['farm-2'])('farm-3').ink).toBe(INDIGO);
        expect(farmColoursFor([])('farm-1').ink).toBe(SLATE);
    });
});

describe('two of one person\'s farms on the same colour', () => {
    it('the later id (sorted) takes the next free colour; the earlier keeps its own', () => {
        // farm-1 and farm-9 both hash to slate (index 7); "farm-1" sorts first, so farm-9 moves on to the next: green (wraps to 0).
        expect(farmColourIndex('farm-9')).toBe(7);
        const of = farmColoursFor(['farm-9', 'farm-1']);
        expect(of('farm-1').ink).toBe(SLATE);
        expect(of('farm-9').ink).toBe(GREEN);
    });

    it('a chain: when the next colour is taken too it moves on again', () => {
        // farm-1, farm-12 -> slate (7); farm-4 -> green (0). Sorted: farm-1, farm-12, farm-4.
        expect(farmColourIndex('farm-12')).toBe(7);
        expect(farmColourIndex('farm-4')).toBe(0);
        const of = farmColoursFor(['farm-4', 'farm-12', 'farm-1']);
        expect(of('farm-1').ink).toBe(SLATE);
        expect(of('farm-12').ink).toBe(GREEN);
        expect(of('farm-4').ink).toBe(BLUE);
    });

    it('the order the list arrives in does not change anyone\'s colour', () => {
        const ids = ['farm-1', 'farm-9', 'farm-12', 'farm-4', 'farm-2'];
        const a = farmColoursFor(ids);
        const b = farmColoursFor([...ids].reverse());
        for (const id of ids) expect(b(id).ink).toBe(a(id).ink);
    });

    it('the same farm listed twice is one farm, not a clash with itself', () => {
        const of = farmColoursFor(['farm-1', 'FARM-1', 'farm-1 ']);
        expect(of('farm-1').ink).toBe(SLATE);
    });

    it('nine farms: eight different colours, and the ninth shares its own colour (there is no ninth)', () => {
        const ids = ['farm-1', 'farm-2', 'farm-3', 'farm-4', 'farm-5', 'farm-6', 'farm-7', 'farm-8', 'farm-9'];
        const of = farmColoursFor(ids);
        const sorted = [...ids].sort();
        const firstEight = sorted.slice(0, 8).map(id => of(id).ink);
        expect(new Set(firstEight).size).toBe(8);
        const ninth = sorted[8]!;
        expect(of(ninth).ink).toBe(FARM_PALETTE[farmColourIndex(ninth)]!.ink);
    });
});
