// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WeeklyDashboard tests — Decision 4b (2026-07-19, screen honesty):
 *   - "उचल दिली" (hardcoded ₹0 server-side, no advance engine yet) is hidden
 *     outright, regardless of the data passed in.
 *   - The money-bar's उचल segment/legend only appears once there's a real
 *     (> 0) advance — it must not show a confident ₹0 for an untracked value.
 *   - हजेरी वही button removed (Stage 5 ledger not built; always empty).
 *   - Honest empty states for "insight" and "plots" instead of a heading
 *     floating over nothing.
 *
 * Truth audit (question 2):
 *   - The week heading renders only for a readable week RANGE. The server
 *     sends a bare machine date, which is neither readable to a Marathi
 *     reader nor a week.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import WeeklyDashboard from '../WeeklyDashboard';
import type { LabourData } from '../../labourMock';
import { EMPTY_LABOUR_DATA, LABOUR_MOCK, inr } from '../../labourMock';
import { LABOUR_WINDOW_ORDER, type LabourWindow } from '../../labourWindow';

const noop = () => {};
// Task 11 (spec: 2026-08-28-labour-v2-release-1) — the screen now takes the
// time window it is displaying. `alltime` is the founder-chosen default and
// the window every assertion in THIS file was written against (they predate
// the control and are about absence/fabrication, not about the period), so
// pinning it here keeps them testing what they always tested. The window's
// own behaviour lives in `WeeklyDashboard.window.test.tsx`.
const baseProps = () => ({
    onReview: noop,
    onLedger: noop,
    onToast: vi.fn(),
    timeWindow: 'alltime' as const,
    onTimeWindowChange: vi.fn(),
});

describe('WeeklyDashboard — screen honesty (Decision 4b)', () => {
    afterEach(() => cleanup());

    it('never shows "उचल दिली" — hardcoded ₹0 server-side, hidden even when the data has a non-zero value', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
        expect(screen.queryByText('उचल दिली')).toBeNull();
    });

    it('hides the हजेरी वही button — Stage 5 attendance ledger not built, always empty for a real farm', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
        expect(screen.queryByText('हजेरी वही')).toBeNull();
    });

    it('shows the money-bar उचल legend once there is a real advance (> 0)', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
        expect(screen.getByText('उचल')).toBeInTheDocument();
    });

    it('hides the money-bar उचल legend/segment when advance is 0 — never a confident fake ₹0', () => {
        render(<WeeklyDashboard {...baseProps()} data={EMPTY_LABOUR_DATA} />);
        expect(screen.queryByText('उचल')).toBeNull();
    });

    it('shows an honest empty state instead of a blank insight card', () => {
        render(<WeeklyDashboard {...baseProps()} data={EMPTY_LABOUR_DATA} />);
        expect(screen.getByText('अजून सुचवण्यासारखं काही नाही')).toBeInTheDocument();
    });

    it('shows an honest empty state instead of a blank plots card', () => {
        render(<WeeklyDashboard {...baseProps()} data={EMPTY_LABOUR_DATA} />);
        expect(screen.getByText('अजून प्लॉटनिहाय माहिती नाही')).toBeInTheDocument();
    });

    it('shows the real insight/plots content once the data has it (LABOUR_MOCK)', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
        expect(screen.queryByText('अजून सुचवण्यासारखं काही नाही')).toBeNull();
        expect(screen.queryByText('अजून प्लॉटनिहाय माहिती नाही')).toBeNull();
        expect(screen.getByText(LABOUR_MOCK.dashboard.insight)).toBeInTheDocument();
    });

    // TRUTH FIX (truth audit, question 2) — the week heading.
    //
    // WHAT IT CLAIMED: the pill sits directly over the "या आठवड्यात" ("this
    // week") group label, so whatever it prints reads as the name of the week
    // the tiles below it summarise.
    //
    // WHY THE DATA CANNOT BACK IT: the server sends a bare machine date —
    // `GetLabourDataHandler` returns `2026-08-24` for `weekLabel`. A
    // Marathi-reading farmer cannot read an ISO timestamp, and a single day is
    // not a week, so the heading names a span it does not describe.
    //
    // Doctrine P4. The handler is backend and out of this layer (stay-in-layer),
    // so the suppression is here and is not a flag — a real range renders itself.
    const withWeekLabel = (weekLabel: string): LabourData => ({
        ...LABOUR_MOCK,
        dashboard: { ...LABOUR_MOCK.dashboard, weekLabel },
    });

    it('never renders a machine date as the week heading — the exact value the server sends today', () => {
        render(<WeeklyDashboard {...baseProps()} data={withWeekLabel('2026-08-24')} />);
        expect(screen.queryByTestId('weekly-dashboard-week-label')).toBeNull();
        expect(screen.queryByText('2026-08-24')).toBeNull();
    });

    it('an ISO pair is still not a readable week heading — a range of unreadable dates is unreadable', () => {
        render(<WeeklyDashboard {...baseProps()} data={withWeekLabel('2026-08-24 – 2026-08-30')} />);
        expect(screen.queryByTestId('weekly-dashboard-week-label')).toBeNull();
    });

    it('renders no week heading at all when the label is blank rather than an empty pill', () => {
        render(<WeeklyDashboard {...baseProps()} data={EMPTY_LABOUR_DATA} />);
        expect(screen.queryByTestId('weekly-dashboard-week-label')).toBeNull();
    });

    it('renders the week heading once it really is a readable range (LABOUR_MOCK: ७–१३ जुलै)', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
        // Read off the fixture, never a literal — this is the fix's other half:
        // the day the server sends a real range, the heading comes back.
        expect(screen.getByTestId('weekly-dashboard-week-label'))
            .toHaveTextContent(LABOUR_MOCK.dashboard.weekLabel);
    });

    // TASK 1 (spec: 2026-08-28-labour-v2-release-1, P4) — Earned money is
    // unknown, not zero. `GetLabourDataHandler` computes RecordedWages purely
    // from job-card evidence; production holds zero job cards while real
    // labour money IS paid out, so treating the absence as `0` fabricated an
    // "overpaid" (जास्त दिलं) claim against a farmer who was never overpaid.
    // `d.owed`/`d.money.recorded`/`d.money.owed` are now `number | null`;
    // `null` must never render as ₹0 or drive a fabricated balance.
    describe('Task 1 — Earned unknown (P4), never a fabricated ₹0/overpayment', () => {
        const withOwed = (owed: number | null): LabourData => ({
            ...LABOUR_MOCK,
            dashboard: { ...LABOUR_MOCK.dashboard, owed },
        });

        // Mirrors real server output: `Dashboard.Owed` and `Money.Owed` are
        // DERIVED from the same `totalOwed` in `GetLabourDataHandler`, so a
        // fixture that varies one without the other would not be a shape the
        // backend can actually send.
        const withMoney = (recorded: number | null, owed: number | null): LabourData => ({
            ...LABOUR_MOCK,
            dashboard: {
                ...LABOUR_MOCK.dashboard,
                owed,
                money: { ...LABOUR_MOCK.dashboard.money, recorded, owed },
            },
        });

        it('omits the बाकी देणं/जास्त दिलं stat tile entirely when Owed is unknown (null)', () => {
            render(<WeeklyDashboard {...baseProps()} data={withOwed(null)} />);
            expect(screen.queryByText('बाकी देणं')).toBeNull();
            expect(screen.queryByText('जास्त दिलं')).toBeNull();
        });

        // TASK 14 / RULING R16 (spec: 2026-08-28-labour-v2-release-1) —
        // SUPERSEDES this test's original claim. This used to assert the tile
        // SHOWS for a real, evidenced Owed figure; R16 ruled बाकी देणं is a
        // POSITION, not a flow, so it no longer belongs in the windowed stat
        // grid AT ALL, evidenced or not. It is not lost — see the dedicated
        // "Task 14 (R16)" describe block below, which confirms both its
        // removal from every window and its continued, readable presence in
        // the पैसे · money card.
        it('no longer shows the stat tile even for a real, evidenced Owed figure (LABOUR_MOCK: 5400) — moved to the money card (R16)', () => {
            render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
            expect(screen.queryByText('बाकी देणं')).toBeNull();
        });

        it('never renders a negative or zero ₹ figure for the overpayment tile as a substitute for null', () => {
            render(<WeeklyDashboard {...baseProps()} data={withOwed(null)} />);
            // The tile (and therefore any ₹ figure it would have carried) is
            // gone outright — not present with a clamped/zeroed value.
            expect(screen.queryByText('₹0')).toBeNull();
        });

        it('renders "—" for काम झालं (money.recorded) when it is unknown, never a fabricated ₹0', () => {
            render(<WeeklyDashboard {...baseProps()} data={withMoney(null, null)} />);
            expect(screen.getByText('—')).toBeInTheDocument();
            expect(screen.queryByText('₹0')).toBeNull();
        });

        it('still renders the real recorded figure once it is known (LABOUR_MOCK: ₹16,800)', () => {
            render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
            expect(screen.getByText(inr(LABOUR_MOCK.dashboard.money.recorded as number))).toBeInTheDocument();
        });

        it('does not render the money-bar बाकी segment/figure when money.owed is null', () => {
            render(<WeeklyDashboard {...baseProps()} data={withMoney(16800, null)} />);
            // The known दिलं figure (₹8,400 in LABOUR_MOCK) still renders...
            expect(screen.getAllByText(inr(LABOUR_MOCK.dashboard.money.paid)).length).toBeGreaterThan(0);
            // ...but no ₹ figure exists anywhere for the unknown owed amount
            // (neither the stat tile nor the money-bar segment).
            expect(screen.queryByText(inr(5400))).toBeNull();
        });
    });

    // TASK 6 (spec: 2026-08-28-labour-v2-release-1, P4) — Defect B: a log
    // where the farmer never stated a headcount used to contribute a
    // confident zero to मजूर-दिवस. `d.manDays` is now `number | null`; `null`
    // must render as `—`, never as the literal word "null"
    // (`String(null) === "null"` in JS — the exact bug this locks against).
    describe('Task 6 — Man-days unknown (P4), never the literal word "null" or a fabricated 0', () => {
        const withManDays = (manDays: number | null): LabourData => ({
            ...LABOUR_MOCK,
            dashboard: { ...LABOUR_MOCK.dashboard, manDays },
        });

        it('renders "—" for मजूर-दिवस when manDays is unknown (null), never the string "null"', () => {
            render(<WeeklyDashboard {...baseProps()} data={withManDays(null)} />);
            expect(screen.getByText('—')).toBeInTheDocument();
            expect(screen.queryByText('null')).toBeNull();
            expect(screen.queryByText('0')).toBeNull();
        });

        it('still shows the real मजूर-दिवस figure once it is known (LABOUR_MOCK: 28)', () => {
            render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
            expect(screen.getByText('28')).toBeInTheDocument();
        });

        it('renders a genuine 0 (a real, known fact) distinctly from unknown — never "—" for a real zero', () => {
            render(<WeeklyDashboard {...baseProps()} data={withManDays(0)} />);
            expect(screen.getByText('0')).toBeInTheDocument();
        });
    });

    // TASK 6c (spec: 2026-08-28-labour-v2-release-1, P4) — completes Tasks 1
    // and 6. Both fixed `GetLabourDataHandler` and this screen's own render
    // sites; neither touched `EMPTY_LABOUR_DATA`, the FALLBACK CONSTANT a
    // real farm renders while `useLabourState` is loading and again if its
    // fetch fails (`useLabourState.ts` — every `setData(EMPTY_LABOUR_DATA)`
    // site) — a state rural
    // connectivity makes common, not rare. That constant still hardcoded the
    // same five fields Tasks 1 and 6 made nullable to a fabricated `0`, so an
    // outage rendered a confident "0 मजूर-दिवस" and "बाकी देणं ₹0" underneath
    // the "couldn't load" banner. (That last part is HISTORY as of Task 6d,
    // 2026-08-28: `LabourFeature.tsx` now withholds the whole content switch
    // on `error`, so an outage renders the banner and nothing else — this
    // screen is not reachable in that state at all. `showInitialLoading`,
    // named here before, no longer exists. The constant below still matters:
    // it is what a real farm renders while LOADING, and what any future
    // caller would render.) Ruling R8: absence of any
    // record — an outage means we could not reach it, not that the farmer
    // said nothing happened — is always the unknown case, never a genuine 0.
    //
    // Uses the real `EMPTY_LABOUR_DATA` export (not a synthetic fixture) on
    // purpose: this locks the actual fallback object every real farm sees,
    // not a stand-in shaped like it.
    describe('Task 6c — the outage/loading fallback constant is not a fabricated zero', () => {
        it('मजूर-दिवस renders "—" for the real EMPTY_LABOUR_DATA fallback, never "0" or the string "null"', () => {
            render(<WeeklyDashboard {...baseProps()} data={EMPTY_LABOUR_DATA} />);
            const label = screen.getByText('मजूर-दिवस');
            expect(label.previousElementSibling?.textContent).toBe('—');
        });

        it('काम झालं (money.recorded) renders "—" for the real EMPTY_LABOUR_DATA fallback, never ₹0', () => {
            render(<WeeklyDashboard {...baseProps()} data={EMPTY_LABOUR_DATA} />);
            const label = screen.getByText('काम झालं · एकूण नोंदवलं');
            expect(label.nextElementSibling?.textContent).toBe('—');
        });

        it('omits the बाकी देणं/जास्त दिलं stat tile entirely for the real EMPTY_LABOUR_DATA fallback, never a fabricated ₹0/overpayment', () => {
            render(<WeeklyDashboard {...baseProps()} data={EMPTY_LABOUR_DATA} />);
            // The stat tile itself (label text) is gone outright — not present
            // with a clamped ₹0. (This note used to add that `paid`'s own real
            // "₹0" still rendered in the money bar's दिलं segment, so the test
            // could not assert on "₹0" globally. As of Task 13 / R15 that bar
            // is not drawn at all when काम झालं is unknown — a bar cannot show
            // the parts of an unknown whole — so the segment no longer exists
            // here. The assertions below are unchanged and still correct; only
            // the reason for their narrowness has.)
            expect(screen.queryByText('बाकी देणं')).toBeNull();
            expect(screen.queryByText('जास्त दिलं')).toBeNull();
        });
    });

    // TASK 14 / RULING R16 (spec: 2026-08-28-labour-v2-release-1) — ONE CLEAN
    // MENTAL MODEL: the stat grid holds FLOWS that accrue over the selected
    // window (मजूर-दिवस · मजुरी · नोंदी); the पैसे · money card holds
    // POSITIONS — where the farmer stands as of now, already labelled
    // आजपर्यंत (R15, Task 13). `बाकी देणं`/`जास्त दिलं` is a position (R13,
    // Task 10 already ruled this), so leaving it inside the WINDOWED grid was
    // the one tile a farmer saw sit frozen when he slid to आज while every
    // neighbour changed, with nothing on screen explaining why. Removed from
    // the grid outright, in every window, for both polarities of Owed — it is
    // not lost, the money card already renders it as a labelled बाकी segment.
    describe('Task 14 (R16) — बाकी देणं/जास्त दिलं is a position, never in the windowed stat grid', () => {
        afterEach(() => cleanup());

        const withOwed = (owed: number | null): LabourData => ({
            ...LABOUR_MOCK,
            dashboard: {
                ...LABOUR_MOCK.dashboard,
                owed,
                money: { ...LABOUR_MOCK.dashboard.money, owed },
            },
        });

        it.each(LABOUR_WINDOW_ORDER)(
            'the stat grid carries no बाकी देणं tile under %s, even with a real owed figure (LABOUR_MOCK)',
            (window: LabourWindow) => {
                render(<WeeklyDashboard {...baseProps()} timeWindow={window} data={LABOUR_MOCK} />);
                const grid = screen.getByTestId('labour-stat-grid');
                expect(within(grid).queryByText('बाकी देणं')).toBeNull();
                expect(within(grid).queryByText('जास्त दिलं')).toBeNull();
            },
        );

        it.each(LABOUR_WINDOW_ORDER)(
            'the stat grid carries no जास्त दिलं tile under %s either — the overpaid case',
            (window: LabourWindow) => {
                render(<WeeklyDashboard {...baseProps()} timeWindow={window} data={withOwed(-500)} />);
                const grid = screen.getByTestId('labour-stat-grid');
                expect(within(grid).queryByText('जास्त दिलं')).toBeNull();
                expect(within(grid).queryByText('बाकी देणं')).toBeNull();
            },
        );

        it('the figure is not lost — it is still readable in the पैसे · money card as a labelled बाकी segment (LABOUR_MOCK)', () => {
            render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
            const card = screen.getByTestId('labour-money-card');
            // The legend names the colour...
            expect(within(card).getByText('बाकी')).toBeInTheDocument();
            // ...and the bar segment itself carries the readable ₹ figure —
            // not merely an unlabelled block of colour.
            expect(within(card).getByText(inr(LABOUR_MOCK.dashboard.money.owed as number))).toBeInTheDocument();
        });

        it('absence stays absence — owed: null still renders no fabricated ₹0 anywhere, grid or card (Task 1 invariant preserved)', () => {
            render(<WeeklyDashboard {...baseProps()} data={withOwed(null)} />);
            expect(screen.queryByText('₹0')).toBeNull();
            expect(screen.queryByText('बाकी देणं')).toBeNull();
            expect(screen.queryByText('जास्त दिलं')).toBeNull();
        });
    });

    // TASK 16 (spec: 2026-08-28-labour-v2-release-1, founder option c) — the
    // stat grid held exactly three tiles (मजूर-दिवस · मजुरी · नोंदी) in a
    // 2-column grid, so the third sat alone beside a blank cell. Founder chose
    // c: मजूर-दिवस and मजुरी stay side by side on the top row; नोंदी becomes a
    // full-width bar underneath them — no tile shrinks, nothing else moves.
    describe('Task 16 — नोंदी becomes a full-width bar, not a lone tile beside an empty cell', () => {
        afterEach(() => cleanup());

        it('मजूर-दिवस and मजुरी stay plain top-row tiles; नोंदी is the only one spanning full width; no filler node fakes the old empty cell', () => {
            render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);

            const grid = screen.getByTestId('labour-stat-grid');
            // Exactly the three real tiles as direct grid items — no fourth
            // node was added to paper over the old empty cell.
            expect(grid.children).toHaveLength(3);

            const manDaysItem = screen.getByText('मजूर-दिवस').closest('button');
            const wagesItem = screen.getByText('मजुरी').closest('button');
            const logsLabel = screen.getByText('नोंदी');
            const logsItem = Array.from(grid.children).find((el) => el.contains(logsLabel));

            expect(manDaysItem).not.toBeNull();
            expect(wagesItem).not.toBeNull();
            expect(logsItem).not.toBeUndefined();
            // The two top-row tiles keep their plain single-column footprint...
            expect(manDaysItem!.className).not.toMatch(/col-span/);
            expect(wagesItem!.className).not.toMatch(/col-span/);
            // ...while नोंदी's own grid item is the one made full-width.
            expect(logsItem!.className).toMatch(/col-span-2/);
        });

        // THE CONFUSION GUARD — the one thing that must not go wrong. नोंदी
        // sits directly above तपासायचं, and both are full-width once this
        // ships. तपासायचं is a tappable approval inbox (chevron + count pill +
        // real onClick); नोंदी is a stat about the selected window, styled
        // exactly like its two neighbours above it. Blurring the two would
        // read as the number itself inviting a tap it does nothing for.
        it('नोंदी carries no chevron, no count pill, no tap target — तपासायचं keeps all three', () => {
            render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);

            const grid = screen.getByTestId('labour-stat-grid');
            const logsLabel = within(grid).getByText('नोंदी');
            const logsButton = logsLabel.closest('button');
            expect(logsButton).not.toBeNull();
            // Same inert treatment as मजूर-दिवस/मजुरी — a StatTile with no
            // onClick renders `disabled`, so it is not a real tap target.
            expect(logsButton).toBeDisabled();
            // Scoped to नोंदी's WHOLE grid item (wrapper + button), not just
            // the button — a chevron/pill slipped in beside the button
            // rather than inside it must be caught just as surely.
            const logsItem = Array.from(grid.children).find((el) => el.contains(logsLabel));
            expect(logsItem).not.toBeUndefined();
            expect(logsItem!.querySelector('svg.lucide-chevron-right')).toBeNull();
            expect(within(grid).queryByTestId('labour-review-strip-count')).toBeNull();

            const strip = screen.getByTestId('labour-review-strip');
            expect(strip.tagName).toBe('BUTTON');
            expect(strip).not.toBeDisabled();
            expect(strip.querySelector('svg.lucide-chevron-right')).not.toBeNull();
            expect(within(strip).getByTestId('labour-review-strip-count')).toBeInTheDocument();
        });
    });
});
