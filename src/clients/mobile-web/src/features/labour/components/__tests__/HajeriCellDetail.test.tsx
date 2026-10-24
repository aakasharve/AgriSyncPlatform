// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HajeriCellDetail — master review D4 item 4: person-day detail ONLY on tap
 * (marks + stated hours + arrangement + work context), and final direction §2:
 * the week reads DIMENSIONALLY here — 5 पूर्ण · 1 अर्धा · 2 रात्री · 3 तास
 * जादा — never one invented number.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HajeriCellDetail from '../HajeriCellDetail';
import type { LedgerRow, LedgerCell } from '../../labour.types';

afterEach(() => cleanup());

const cell = (over: Partial<LedgerCell>): LedgerCell => ({
    day: null, night: null, hours: null, extraHours: null, ukte: false, work: null, ...over,
});

const row: LedgerRow = {
    personId: 'op:1', fieldOperatorId: '1', name: 'गणेश', initial: 'ग', tone: 'or',
    cells: [
        cell({ day: 'full' }),
        cell({ day: 'full', night: 'worked' }),
        cell({ day: 'half' }),
        cell({ night: 'worked', hours: 3 }),
        cell({ day: 'full', extraHours: 2, ukte: true, work: 'द्राक्ष छाटणी' }),
        null,
        null,
    ],
};

describe('HajeriCellDetail — detail only on tap, week only in dimensions', () => {
    it('shows the person-day facts: marks, stated hours, arrangement, work context', () => {
        const { container } = render(
            <HajeriCellDetail row={row} dayIndex={4} dayIso="2026-08-28" onClose={vi.fn()} />);

        expect(container.textContent).toContain('गणेश');
        expect(container.textContent).toContain('पूर्ण');
        expect(container.textContent).toContain('जादा 2 तास');
        expect(container.textContent).toContain('उक्ते काम');
        expect(container.textContent).toContain('द्राक्ष छाटणी');
    });

    it('reads the week dimensionally and never as one number', () => {
        const { container } = render(
            <HajeriCellDetail row={row} dayIndex={0} dayIso="2026-08-24" onClose={vi.fn()} />);

        const week = container.querySelector('[data-testid="dimensional-week"]')!;
        expect(week.textContent).toContain('3 पूर्ण');
        expect(week.textContent).toContain('1 अर्धा');
        expect(week.textContent).toContain('2 रात्री');
        expect(week.textContent).toContain('जादा 2 तास');
        // the one-number week must not exist: no '4.5', no summed figure
        expect(container.textContent).not.toContain('4.5');
    });

    it('omits dimensions that have no stated fact — never a fabricated 0', () => {
        const bare: LedgerRow = { ...row, cells: [cell({ day: 'half' }), null] };
        const { container } = render(
            <HajeriCellDetail row={bare} dayIndex={0} dayIso="2026-08-24" onClose={vi.fn()} />);

        const week = container.querySelector('[data-testid="dimensional-week"]')!;
        expect(week.textContent).toContain('1 अर्धा');
        expect(week.textContent).not.toContain('0 पूर्ण');
        expect(week.textContent).not.toContain('0 रात्री');
    });
});
