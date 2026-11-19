// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane HONESTY-1, item H10; doctrine P4)
 *
 * The amber card "काम मागे पडतंय" (work is falling behind) said a farmer was late from two thresholds that are the same for every crop:
 * 10 days since a spray, 3 days since water ("फवारणी करून N दिवस झाले" / "पाणी देऊन N दिवस झाले"). A farm that waters every week was
 * told it was behind. The verdict is gone. The facts stay where they were: the "शेवटची फवारणी" / "शेवटचं पाणी" tiles, untouched. The
 * two plain counts that lived in the same card ("आज N कामं बाकी", the to-do list) are kept, in a plain box with no title and no amber.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ScheduleTools, openWorkLines, type ToolsFacts } from '../ScheduleTools';

afterEach(cleanup);

const facts = (over: Partial<ToolsFacts> = {}): ToolsFacts => ({ dueToday: 0, tasksOpen: 0, lastActions: { sprayDaysAgo: null, irrigationDaysAgo: null }, ...over });
const mount = (f: ToolsFacts) => render(<ScheduleTools facts={f} todaySpend={0} onOpenMoney={vi.fn()} libraryCount={2} />);

describe('H10 - no lateness verdict from invented thresholds', () => {
    it('a spray 12 days ago and water 6 days ago (both past the old thresholds): no amber card, no title, no "N दिवस झाले" line', () => {
        const { container } = mount(facts({ lastActions: { sprayDaysAgo: 12, irrigationDaysAgo: 6 } }));
        const text = container.textContent ?? '';
        expect(screen.queryByTestId('risk-card')).toBeNull();
        expect(text).not.toContain('काम मागे पडतंय');
        expect(text).not.toMatch(/दिवस झाले/);
        expect(container.querySelector('[class*="amber"]')).toBeNull();
        expect(openWorkLines(facts({ lastActions: { sprayDaysAgo: 12, irrigationDaysAgo: 6 } }))).toEqual([]);
    });

    it('the facts are still shown, as the two tiles, untouched', () => {
        mount(facts({ lastActions: { sprayDaysAgo: 12, irrigationDaysAgo: 6 } }));
        expect(screen.getByTestId('last-spray')).toHaveTextContent('12 दिवसांपूर्वी');
        expect(screen.getByTestId('last-water')).toHaveTextContent('6 दिवसांपूर्वी');
        expect(screen.getByText('शेवटची फवारणी')).toBeInTheDocument();
        expect(screen.getByText('शेवटचं पाणी')).toBeInTheDocument();
    });

    it('nothing recorded yet and nothing open: the tiles say so and nothing else is drawn above them', () => {
        mount(facts());
        expect(screen.getByTestId('last-spray')).toHaveTextContent('अजून नोंद नाही');
        expect(screen.queryByTestId('open-work')).toBeNull();
        expect(screen.queryByTestId('risk-card')).toBeNull();
    });

    it('the two plain counts are kept - in a plain box, titled by nothing and amber-free', () => {
        const { container } = mount(facts({ dueToday: 1, tasksOpen: 2, lastActions: { sprayDaysAgo: 30, irrigationDaysAgo: 30 } }));
        const box = screen.getByTestId('open-work');
        expect(box.textContent).toContain('आज 1 कामं बाकी');
        expect(box.textContent).toContain('करायच्या यादीत 2 कामं बाकी');
        expect(box.className).not.toMatch(/amber/);
        expect(container.textContent).not.toContain('काम मागे पडतंय');
        // exactly the two counts - the old gap lines are not among them, however long the gaps are
        expect(openWorkLines(facts({ dueToday: 1, tasksOpen: 2, lastActions: { sprayDaysAgo: 30, irrigationDaysAgo: 30 } }))).toEqual(['आज 1 कामं बाकी', 'करायच्या यादीत 2 कामं बाकी']);
    });
});
