// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The पैसे · money card — Task 13 / RULING R15 (spec:
 * 2026-08-28-labour-v2-release-1).
 *
 * WHY THIS FILE EXISTS. R13 (Task 10) correctly ruled that बाकी is a BALANCE
 * and must not follow the time window — windowing it showed ₹900 owed where
 * the true outstanding figure was ₹13,500. But it was applied at the wrong
 * GRANULARITY: `Owed` alone stopped being windowed while `Recorded` and
 * `Paid`, the other two terms of the SAME card, stayed windowed. The money
 * card draws ONE stacked bar whose entire grammar is the identity
 *
 *     काम झालं = दिलं + उचल + बाकी
 *
 * so mixing bases turned its segments into incommensurable quantities drawn as
 * parts of one whole. Rendered against the real `FullScenario` fixture under
 * आज, the card's header read ₹1,000 while the bar drew ₹100 + ₹13,500 —
 * `बाकी` filling ~99% of a bar headed ₹1,000.
 *
 * R15: the money card is a POSITION card — every figure in it is all-time,
 * because they exist together to explain ONE settlement position (what he has
 * recorded, paid, advanced and still owes to date). The stat TILES above it
 * stay windowed; those genuinely are "what happened in this window".
 *
 * FIVE GREEN SUITES MISSED THIS because not one of them asserted the bar's
 * internal arithmetic — every money test checked a figure in isolation. The
 * first describe below is that missing assertion, and it is written to hold
 * for ANY data, not just a fixture chosen to satisfy it.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import WeeklyDashboard from '../WeeklyDashboard';
import type { LabourData } from '../../labourMock';
import { EMPTY_LABOUR_DATA, LABOUR_MOCK, inr } from '../../labourMock';
import { LABOUR_WINDOW_ORDER, LABOUR_WINDOW_LABELS, type LabourWindow } from '../../labourWindow';

const baseProps = (timeWindow: LabourWindow = 'alltime') => ({
    onReview: vi.fn(),
    onLedger: vi.fn(),
    onToast: vi.fn(),
    timeWindow,
    onTimeWindowChange: vi.fn(),
});

type Money = LabourData['dashboard']['money'];

const withMoney = (money: Money): LabourData => ({
    ...LABOUR_MOCK,
    dashboard: { ...LABOUR_MOCK.dashboard, owed: money.owed, money },
});

/** '₹13,500' → 13500. The figure a farmer actually reads, not the prop. */
const rupees = (text: string): number => Number(text.replace(/[^0-9.-]/g, ''));

/** Every segment the bar actually drew, as {drawn width, printed figure}. */
const segments = () =>
    screen.queryAllByTestId('labour-money-segment').map((el) => ({
        grow: Number((el as HTMLElement).style.flexGrow),
        amount: rupees(el.textContent ?? ''),
    }));

const headerText = () => screen.getByTestId('labour-money-total').textContent ?? '';

describe('money card — the bar always adds up to its own header', () => {
    afterEach(() => cleanup());

    /**
     * THE INVARIANT, stated once and applied to every shape below: a stacked
     * bar drawn under a header claims its segments are the PARTS of that
     * header. So either the parts sum to it, or there is no bar. There is no
     * third honest option — and "draw whatever we have" was the defect.
     *
     * Asserted on BOTH the printed figure and the drawn `flex-grow`, because
     * the reported defect lived in the geometry (`flex-grow: 100` beside
     * `flex-grow: 13500`) while the text alone would have looked plausible.
     */
    const expectCoherentBarOrNoBar = () => {
        const drawn = segments();
        if (drawn.length === 0) {
            expect(screen.queryByTestId('labour-money-bar')).toBeNull();
            return;
        }
        const header = rupees(headerText());
        expect(headerText()).not.toBe('—');
        expect(drawn.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(header, 2);
        expect(drawn.reduce((s, x) => s + x.grow, 0)).toBeCloseTo(header, 2);
    };

    it.each(LABOUR_WINDOW_ORDER)(
        'segments sum to the header under %s — the real fixture',
        (window) => {
            render(<WeeklyDashboard {...baseProps(window)} data={LABOUR_MOCK} />);
            expectCoherentBarOrNoBar();
        },
    );

    it.each(LABOUR_WINDOW_ORDER)('segments sum to the header under %s — the empty farm', (window) => {
        render(<WeeklyDashboard {...baseProps(window)} data={EMPTY_LABOUR_DATA} />);
        expectCoherentBarOrNoBar();
    });

    /**
     * THE EXACT REPORTED DEFECT, as a shape rather than as a description: the
     * आज column of `LabourWindowScopingTests.FullScenario` — ₹1,000 recorded
     * today, ₹100 paid today, ₹13,500 owed all-time. The server can no longer
     * produce it (R15 makes all four all-time), so this is a belt on the
     * render site: even handed an incoherent triple, the card must not draw
     * ₹13,500 as a slice of ₹1,000.
     */
    it('never draws a ₹13,500 segment inside a ₹1,000 header, even if handed that mix', () => {
        render(
            <WeeklyDashboard
                {...baseProps('today')}
                data={withMoney({ recorded: 1000, paid: 100, advance: 0, owed: 13500 })}
            />,
        );

        expectCoherentBarOrNoBar();
        expect(segments()).toHaveLength(0);
    });

    /**
     * The other half of the same mistake, in the direction the state test
     * pinned: an em-dash header (काम झालं unknown) with a real ₹7,100 segment
     * inside it. A bar cannot show the parts of an unknown whole.
     */
    it('draws no bar at all when काम झालं is unknown — never segments inside an em-dash', () => {
        render(
            <WeeklyDashboard
                {...baseProps('today')}
                data={withMoney({ recorded: null, paid: 900, advance: 0, owed: 7100 })}
            />,
        );

        expect(headerText()).toBe('—');
        expect(segments()).toHaveLength(0);
        expect(screen.queryByTestId('labour-money-bar')).toBeNull();
        // Scoped to the CARD on purpose. ₹7,100 still renders on screen — as
        // the बाकी देणं stat tile, which is a figure in its own right and is
        // out of R15's scope (R13 governs it). What must not exist is that
        // figure drawn as a SLICE of an unknown total.
        const card = screen.getByTestId('labour-money-card');
        expect(card.textContent).not.toContain(inr(7100));
        expect(card.textContent).not.toContain(inr(900));
    });

    /**
     * The `recorded !== null` clause on its own, isolated. Found by mutating
     * that clause away: with `null` coercing to 0 in arithmetic, the identity
     * check ALONE happens to reject every other unknown-काम-झालं shape, so
     * removing the explicit null guard left every other test still green. The
     * one shape it does not reject is an unknown total whose parts are all
     * zero — 0 − (0 + 0 + 0) is a passing identity — which would draw ₹0
     * segments inside an em-dash. Unreachable from today's server (`recorded`
     * and `owed` are null together), which is exactly why only a test written
     * against the clause itself keeps it honest.
     */
    it('draws no bar for an unknown काम झालं even when its would-be parts are all ₹0', () => {
        render(
            <WeeklyDashboard
                {...baseProps()}
                data={withMoney({ recorded: null, paid: 0, advance: 0, owed: 0 })}
            />,
        );

        expect(headerText()).toBe('—');
        expect(segments()).toHaveLength(0);
        expect(screen.queryByTestId('labour-money-bar')).toBeNull();
    });

    it('draws no bar when the farm is overpaid — बाकी below zero has no slice to draw', () => {
        render(
            <WeeklyDashboard
                {...baseProps()}
                data={withMoney({ recorded: 1000, paid: 1500, advance: 0, owed: -500 })}
            />,
        );

        // The header still states the fact it can state...
        expect(headerText()).toBe(inr(1000));
        // ...but ₹1,500 is never drawn as a part of ₹1,000.
        expect(segments()).toHaveLength(0);
        expect(screen.queryByTestId('labour-money-bar')).toBeNull();
    });

    it('still draws the bar for a real, coherent position (LABOUR_MOCK)', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);

        // Not vacuously green: the fixture DOES draw, and it adds up.
        expect(segments().length).toBeGreaterThan(0);
        expectCoherentBarOrNoBar();
    });
});

describe('money card — a POSITION, so it never moves with the window (R15)', () => {
    afterEach(() => cleanup());

    it('renders identical money figures under all four windows', () => {
        const rendered: string[] = [];
        for (const window of LABOUR_WINDOW_ORDER) {
            const { unmount } = render(<WeeklyDashboard {...baseProps(window)} data={LABOUR_MOCK} />);
            rendered.push(screen.getByTestId('labour-money-card').textContent ?? '');
            unmount();
        }

        expect(new Set(rendered).size).toBe(1);
    });

    /**
     * The card must SAY which basis it is on, so the screen does not silently
     * carry two time bases — the stat tiles above it follow the slider, this
     * card does not. `आजपर्यंत` is the founder-approved word the slider
     * already ships (`labourWindow.ts`); reusing it here is reuse, not a new
     * string, and no other word was invented.
     */
    it.each(LABOUR_WINDOW_ORDER)('names its basis आजपर्यंत on the card under %s', (window) => {
        render(<WeeklyDashboard {...baseProps(window)} data={LABOUR_MOCK} />);

        expect(screen.getByTestId('labour-money-basis')).toHaveTextContent(LABOUR_WINDOW_LABELS.alltime);
        // ...and it is inside the card it qualifies, not floating on the screen.
        expect(screen.getByTestId('labour-money-card'))
            .toContainElement(screen.getByTestId('labour-money-basis'));
    });

    it('states the basis even when काम झालं itself is unknown — the basis is not a figure', () => {
        render(<WeeklyDashboard {...baseProps('week')} data={EMPTY_LABOUR_DATA} />);

        expect(screen.getByTestId('labour-money-basis')).toHaveTextContent(LABOUR_WINDOW_LABELS.alltime);
    });

    /** The stat tiles are NOT affected by R15 — they still name the window. */
    it.each(LABOUR_WINDOW_ORDER)('leaves the stat-grid heading naming the window (%s), not आजपर्यंत', (window) => {
        render(<WeeklyDashboard {...baseProps(window)} data={LABOUR_MOCK} />);

        expect(screen.getByTestId('labour-window-heading'))
            .toHaveTextContent(LABOUR_WINDOW_LABELS[window]);
    });
});
