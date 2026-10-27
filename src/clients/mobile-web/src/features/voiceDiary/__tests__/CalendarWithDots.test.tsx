// @vitest-environment jsdom
// spec: voice-diary-e2e-2026-05-17 (D.21)
//
// CalendarWithDots — dot density + select behavior. Tests verify:
//   1. Each day of the shown month renders a cell with the correct count attribute.
//   2. Clicking a cell invokes onSelectDate with the matching dateKey.
//
// spec: plr-d10-redesign-real-integration-2026-10-25 (I17, V-3) — recordings are kept forever, so the
// calendar pages back month by month to his first recording (it offered only the last 30 days), and
// (V-2) month and day names follow his language.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import CalendarWithDots from '../components/CalendarWithDots';
import { daysOfMonth, shiftMonth } from '../calendarMonths';

// Today is 26 Oct 2026 (IST) in every test here.
const TODAY = '2026-10-26';

describe('CalendarWithDots', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-26T06:00:00.000Z'));
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('renders this month\'s days (newest first) with count attribute reflecting countsByDate', () => {
        render(
            <CalendarWithDots
                countsByDate={{ [TODAY]: 4, '2026-10-25': 1 }}
                selectedDateKey={TODAY}
                onSelectDate={() => undefined}
            />,
        );

        expect(screen.getByTestId(`voice-diary-calendar-cell-${TODAY}`).getAttribute('data-count')).toBe('4');
        expect(screen.getByTestId('voice-diary-calendar-cell-2026-10-25').getAttribute('data-count')).toBe('1');
        // A day with no entries reports count 0.
        expect(screen.getByTestId('voice-diary-calendar-cell-2026-10-19').getAttribute('data-count')).toBe('0');
        // 26 days of October so far, today first; no day after today.
        const cells = screen.getAllByTestId(/^voice-diary-calendar-cell-/);
        expect(cells).toHaveLength(26);
        expect(cells[0]).toHaveAttribute('data-testid', `voice-diary-calendar-cell-${TODAY}`);
        expect(screen.queryByTestId('voice-diary-calendar-cell-2026-10-27')).toBeNull();
    });

    it('invokes onSelectDate with the cell dateKey when clicked', () => {
        const onSelectDate = vi.fn();
        render(<CalendarWithDots countsByDate={{}} selectedDateKey={TODAY} onSelectDate={onSelectDate} />);
        fireEvent.click(screen.getByTestId('voice-diary-calendar-cell-2026-10-23'));
        expect(onSelectDate).toHaveBeenCalledWith('2026-10-23');
    });

    it('a recording from months ago can be reached: ‹ opens the month before, on its newest recorded day', () => {
        const onSelectDate = vi.fn();
        const counts = { '2026-08-03': 2, '2026-08-17': 1, [TODAY]: 1 };
        render(<CalendarWithDots countsByDate={counts} selectedDateKey={TODAY} onSelectDate={onSelectDate} />);

        // September has no recording: he lands on its last day and can keep going back
        fireEvent.click(screen.getByTestId('voice-diary-calendar-prev'));
        expect(onSelectDate).toHaveBeenLastCalledWith('2026-09-30');
        cleanup();

        render(<CalendarWithDots countsByDate={counts} selectedDateKey="2026-09-30" onSelectDate={onSelectDate} />);
        expect(screen.getAllByTestId(/^voice-diary-calendar-cell-/)).toHaveLength(30);
        fireEvent.click(screen.getByTestId('voice-diary-calendar-prev'));
        expect(onSelectDate).toHaveBeenLastCalledWith('2026-08-17');
        cleanup();

        // August: every day of the month, the old recordings carry their dots, and it is the first month
        render(<CalendarWithDots countsByDate={counts} selectedDateKey="2026-08-17" onSelectDate={onSelectDate} />);
        expect(screen.getAllByTestId(/^voice-diary-calendar-cell-/)).toHaveLength(31);
        expect(screen.getByTestId('voice-diary-calendar-cell-2026-08-03').getAttribute('data-count')).toBe('2');
        expect(screen.queryByTestId('voice-diary-calendar-prev')).toBeNull(); // nothing older to page to
        fireEvent.click(screen.getByTestId('voice-diary-calendar-next'));
        expect(onSelectDate).toHaveBeenLastCalledWith('2026-09-30');
    });

    it('a newly shown month opens with its chosen day in sight; a day picked inside the month does not move the strip', () => {
        // jsdom has no layout: each day cell sits 84px further along the strip than the one before it
        const proto = HTMLElement.prototype;
        const saved = ['offsetLeft', 'offsetWidth'].map(k => [k, Object.getOwnPropertyDescriptor(proto, k)] as const);
        Object.defineProperty(proto, 'offsetLeft', {
            configurable: true,
            get(this: HTMLElement) {
                if (!/^voice-diary-calendar-cell-/.test(this.dataset.testid ?? '')) return 0;
                return Array.from(this.parentElement?.children ?? []).indexOf(this) * 84;
            },
        });
        Object.defineProperty(proto, 'offsetWidth', { configurable: true, get: () => 76 });
        try {
            const counts = { '2026-09-05': 1, [TODAY]: 1 };
            const draw = (selected: string) => (
                <CalendarWithDots countsByDate={counts} selectedDateKey={selected} onSelectDate={() => undefined} />
            );
            const view = render(draw(TODAY));
            const strip = screen.getByTestId('voice-diary-calendar-strip');
            const writes: number[] = [];
            Object.defineProperty(strip, 'scrollLeft', { configurable: true, get: () => writes.at(-1) ?? 0, set: (v: number) => { writes.push(v); } });
            Object.defineProperty(strip, 'clientWidth', { configurable: true, get: () => 300 });

            // September opens on the 5th (its day with a recording; 26th along, newest first): scrolled so
            // that day is centred
            view.rerender(draw('2026-09-05'));
            expect(writes).toEqual([25 * 84 - (300 - 76) / 2]);

            // a day he taps inside September is already on screen: the strip stays where he left it
            view.rerender(draw('2026-09-30'));
            expect(writes).toHaveLength(1);

            // back to this month: its newest day, today, is at the start of the strip
            view.rerender(draw(TODAY));
            expect(writes.at(-1)).toBe(0);
        } finally {
            for (const [k, d] of saved) if (d) Object.defineProperty(proto, k, d);
        }
    });

    it('draws no month buttons that would do nothing (no older recording, already this month)', () => {
        render(<CalendarWithDots countsByDate={{ [TODAY]: 1 }} selectedDateKey={TODAY} onSelectDate={() => undefined} />);
        expect(screen.queryByTestId('voice-diary-calendar-prev')).toBeNull();
        expect(screen.queryByTestId('voice-diary-calendar-next')).toBeNull();
    });

    it('speaks his language: Marathi month and day names, ordinary digits, no English', () => {
        render(<CalendarWithDots countsByDate={{ '2026-09-02': 1 }} selectedDateKey={TODAY} onSelectDate={() => undefined} locale="mr-IN" />);
        const calendar = screen.getByTestId('voice-diary-calendar');
        expect(screen.getByTestId('voice-diary-calendar-month')).toHaveTextContent('ऑक्टोबर 2026');
        expect(screen.getByTestId('voice-diary-calendar-prev')).toHaveTextContent('सप्टेंबर');
        expect(calendar.textContent ?? '').not.toMatch(/[A-Za-z]/);
        expect(screen.getByTestId(`voice-diary-calendar-cell-${TODAY}`)).toHaveTextContent('26');
    });
});

describe('calendar month arithmetic', () => {
    it('shiftMonth crosses year ends both ways', () => {
        expect(shiftMonth('2026-01', -1)).toBe('2025-12');
        expect(shiftMonth('2025-12', 1)).toBe('2026-01');
        expect(shiftMonth('2026-10', -14)).toBe('2025-08');
    });

    it('daysOfMonth: a whole past month (leap February too), this month up to today, none after today', () => {
        expect(daysOfMonth('2024-02', TODAY)).toHaveLength(29);
        expect(daysOfMonth('2026-02', TODAY)).toHaveLength(28);
        expect(daysOfMonth('2026-10', TODAY)[0]).toBe(TODAY);
        expect(daysOfMonth('2026-10', TODAY).at(-1)).toBe('2026-10-01');
        expect(daysOfMonth('2026-11', TODAY)).toEqual([]);
    });
});
