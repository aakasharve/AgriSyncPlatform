/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-4) — the आढावा folds and order, as rules.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER, firstOpen, foldsOf, isOpen, moved, orderFromLegacy, orderOf, toggled, type SectionId } from '../overview/sectionLayout';

const ALL: SectionId[] = ['status', 'todo', 'day', 'notes', 'calendar', 'cost'];

describe('sectionLayout (D-4)', () => {
    it('first use: V1 all open; V2 the picker, the to-dos, the day and the calendar open; V3 all but calendar and money', () => {
        expect(ALL.filter(id => firstOpen('v1', id))).toEqual(ALL);
        expect(ALL.filter(id => firstOpen('v2', id))).toEqual(['status', 'todo', 'day', 'calendar']);
        expect(ALL.filter(id => firstOpen('v3', id))).toEqual(['status', 'todo', 'day', 'notes']);
    });

    it('his choice wins; on V2 his LIVE choice comes next; then the first-use state', () => {
        expect(isOpen('v2', 'notes', {}, {})).toBe(false);
        expect(isOpen('v2', 'notes', {}, { notes: true })).toBe(true);
        expect(isOpen('v2', 'notes', { notes: false }, { notes: true })).toBe(false);
        expect(isOpen('v3', 'notes', {}, { notes: false })).toBe(true); // LIVE keys feed the real version only
    });

    it('V3 opens calendar and money one at a time; V2 does not', () => {
        const opened = toggled('v3', 'calendar', {}, {});
        expect(toggled('v3', 'cost', opened, {})).toEqual({ calendar: false, cost: true });
        expect(toggled('v2', 'cost', { calendar: true }, {})).toEqual({ calendar: true, cost: true });
    });

    it('order: a stored order is made whole, LIVE\'s "notes before the day" is kept, a move stops at the edge', () => {
        expect(orderOf(['cost', 'nope', 'cost'])).toEqual(['cost', 'calendar', 'day', 'notes', 'todo']);
        expect(orderOf('x')).toBeNull();
        expect(orderFromLegacy(['farm-status', 'notes', 'daily-logs'])).toEqual(['calendar', 'notes', 'day', 'todo', 'cost']);
        expect(orderFromLegacy(['farm-status', 'daily-logs', 'notes'])).toBeNull();
        expect(moved(DEFAULT_ORDER, 'calendar', -1)).toEqual([...DEFAULT_ORDER]);
        expect(moved(DEFAULT_ORDER, 'cost', -1)).toEqual(['calendar', 'day', 'notes', 'cost', 'todo']);
    });

    it('only known sections and real booleans are read back', () => {
        expect(foldsOf({ notes: true, bogus: true, day: 'yes' })).toEqual({ notes: true });
        expect(foldsOf(null)).toEqual({});
    });
});
