// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PersonDetail tests — Decision 4b (2026-07-19, screen honesty):
 *   - "उचल द्या" / "पैसे द्या" fire a "— नमुना" placeholder toast only (no
 *     server write) — hidden.
 *   - विश्वास द्या (trust-graduation) promises "25 clean days -> auto-approve"
 *     with no server-side engine behind it — hidden, in every one of its
 *     three states (granted / eligible-recommendation / not-eligible-info).
 *   - The hardcoded "दैनिक ₹300" line (same invented wage for every worker)
 *     is removed outright.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PersonDetail from '../PersonDetail';
import { LABOUR_MOCK } from '../../labourMock';

const baseProps = () => ({
    data: LABOUR_MOCK,
    onAdvance: vi.fn(),
    onSettle: vi.fn(),
    onToast: vi.fn(),
});

describe('PersonDetail — screen honesty (Decision 4b)', () => {
    afterEach(() => cleanup());

    it('hides the उचल द्या / पैसे द्या actions — both are wired to a placeholder toast, not a real write', () => {
        render(<PersonDetail {...baseProps()} personId="ramesh" />);
        expect(screen.queryByText('उचल द्या')).toBeNull();
        expect(screen.queryByText('पैसे द्या')).toBeNull();
    });

    it('hides विश्वास द्या (trust-graduation) even for a worker who would otherwise be "eligible" (रमेश: 27 days, clean record)', () => {
        // Sanity: रमेश is the exact eligible case the old recommendation banner targeted.
        expect(LABOUR_MOCK.people.ramesh.daysActive).toBeGreaterThanOrEqual(25);
        expect(LABOUR_MOCK.people.ramesh.cleanRecord).toBe(true);
        expect(LABOUR_MOCK.people.ramesh.access).not.toBe('trusted');

        render(<PersonDetail {...baseProps()} personId="ramesh" />);

        expect(screen.queryByText('विश्वास द्या')).toBeNull();
        expect(screen.queryByText(/शिफारस · recommendation/)).toBeNull();
        expect(screen.queryByText(/सध्या याच्या नोंदी तुम्ही तपासता/)).toBeNull();
    });

    it('hides विश्वास द्या for an already-"trusted" worker too (सुनीता)', () => {
        expect(LABOUR_MOCK.people.sunita.access).toBe('trusted');
        render(<PersonDetail {...baseProps()} personId="sunita" />);
        expect(screen.queryByText('विश्वास दिला')).toBeNull();
        expect(screen.queryByText('विश्वास काढा')).toBeNull();
    });

    it('removes the hardcoded "दैनिक ₹300" line — the same invented wage for every worker', () => {
        render(<PersonDetail {...baseProps()} personId="ramesh" />);
        expect(screen.queryByText(/दैनिक/)).toBeNull();
    });

    /*
     * FLIPPED 2026-08-10, on evidence — not on a change of taste.
     *
     * This test used to assert the opposite: that a backend-supplied trust score
     * SHOULD still render, because hiding real data would be over-correcting.
     * That was the right instinct under its premise — the premise was just false.
     *
     * The architecture review verified against the running system that
     * ReliabilityScore ALWAYS returns 100 for every worker:
     * GetWorkerMetricsAsync (ShramSafalRepository.cs:1050) returns all-zero
     * metrics, and the scorer treats logCount30d == 0 as a perfect ratio on all
     * three terms. So "a score the backend actually provides" is not evidence of
     * anything — it is a constant wearing the costume of a measurement, attached
     * to a named real person.
     *
     * The mock's trust=76 is what misled the original test: mock data made the
     * feature look evidence-backed when production data cannot be.
     *
     * Frozen invariant 6 (founder, 2026-08-10): no reliability / productivity /
     * trust score may exist unless its underlying evidence exists and is
     * explainable. Flip SHOW_TRUST_SCORE back on — and restore this test to its
     * original assertion — when the score is computed from real work evidence.
     */
    it('hides the विश्वास trust score even when one is supplied, because the backend score is fabricated (सुनीता: trust=76)', () => {
        expect(LABOUR_MOCK.people.sunita.trust).toBe(76);
        render(<PersonDetail {...baseProps()} personId="sunita" />);
        expect(screen.queryByText(/विश्वास 76/)).toBeNull();
    });

    // Task 1 (spec: 2026-08-28-labour-v2-release-1, P4) — a worker with no
    // job-card evidence carries `balance.recorded: null`. BalanceCard must
    // show "—" for कामाचे पैसे (never a fabricated ₹0) and must omit the
    // द्यायचे/उचल बाकी/जास्त दिलं headline + tile entirely (never a balance
    // derived from an unknown). No new Marathi copy is introduced anywhere
    // in this fallback.
    describe('Task 1 — an unknown RecordedWages (null) never becomes a fabricated balance', () => {
        const withUnknownRecorded = () => ({
            ...LABOUR_MOCK,
            people: {
                ...LABOUR_MOCK.people,
                ramesh: { ...LABOUR_MOCK.people.ramesh, balance: { ...LABOUR_MOCK.people.ramesh.balance, recorded: null } },
            },
        });

        it('renders "—" for कामाचे पैसे instead of a fabricated ₹0', () => {
            render(<PersonDetail {...baseProps()} data={withUnknownRecorded()} personId="ramesh" />);
            expect(screen.getByText('कामाचे पैसे')).toBeInTheDocument();
            expect(screen.getByText('—')).toBeInTheDocument();
        });

        it('omits जास्त दिलं / द्यायचे / उचल बाकी entirely rather than deriving a balance from the unknown', () => {
            render(<PersonDetail {...baseProps()} data={withUnknownRecorded()} personId="ramesh" />);
            expect(screen.queryByText('जास्त दिलं')).toBeNull();
            expect(screen.queryByText('द्यायचे')).toBeNull();
            expect(screen.queryByText('उचल बाकी')).toBeNull();
        });

        it('still shows the real balance for a worker whose RecordedWages IS evidenced (सुनीता)', () => {
            render(<PersonDetail {...baseProps()} personId="sunita" />);
            // सुनीता: recorded 2000, paid 500, advance 0 -> owes 1500, "द्यायचे".
            expect(screen.getByText('द्यायचे')).toBeInTheDocument();
        });
    });

    /*
     * TASK 13 (spec: 2026-08-28-labour-v2-release-1) — the balance
     * explanation used to end `− उचल ₹0 · आपोआप वजा`: "minus advance ₹0,
     * automatically deducted".
     *
     * THERE IS NO ADVANCE SYSTEM. `GetLabourDataHandler` hardcodes
     * `advance = 0m` for every worker with no write path anywhere that could
     * ever change it (Stage 4 / LabourAdvance is not built), so the clause
     * asserted a mechanism the app does not have. `MukadamDetail` had the
     * same claim removed in Task 7b; this was the last one left.
     *
     * IT IS ALSO LEGALLY SENSITIVE, which is why deletion (not rewording) is
     * the fix: `docs/DECISIONS-BEFORE-FIRST-FARMERS-2026-08-23.md:278-280`
     * flags advance-worked-off-against-days as a bonded-labour pattern under
     * the Bonded Labour System (Abolition) Act, 1976. Promising automatic
     * deduction of advances from earnings is exactly the shape that decision
     * says the app must not assert. Removing it is subtractive and reduces
     * exposure; no replacement copy was invented.
     */
    describe('Task 13 — the app never claims advances are deducted, for a feature it does not have', () => {
        const everyPersonId = Object.keys(LABOUR_MOCK.people);

        it.each(everyPersonId)('renders no "आपोआप वजा" claim for %s', (personId) => {
            render(<PersonDetail {...baseProps()} personId={personId} />);
            expect(screen.queryByText(/आपोआप वजा/)).toBeNull();
        });

        it.each(everyPersonId)('renders no "उचल ₹0" for %s — a confident zero for an unobservable thing', (personId) => {
            render(<PersonDetail {...baseProps()} personId={personId} />);
            expect(screen.queryByText(/उचल ₹0/)).toBeNull();
        });

        /*
         * The reflow uses ONLY words already in that template — कामाचे पैसे,
         * −, दिलं and the two figures. Pinned as an exact string so a later
         * edit cannot quietly reintroduce a third term.
         */
        it('keeps the surviving explanation to कामाचे पैसे − दिलं (सुनीता: ₹2,000 − ₹500)', () => {
            render(<PersonDetail {...baseProps()} personId="sunita" />);
            expect(screen.getByText('कामाचे पैसे ₹2,000 − दिलं ₹500')).toBeInTheDocument();
        });

        /*
         * रमेश carries a mock उचल of ₹2,000, so his बाकी tile subtracts a
         * third term the two-term line above cannot account for. The line
         * explains the balance; when it cannot, it is omitted outright —
         * the same "leave the gap" treatment `recorded === null` already
         * gets, and again no new copy. (Unreachable from the real server,
         * which sends advance 0m for everyone; reachable from this mock.)
         */
        it('omits the explanation entirely rather than under-explaining a balance that has an उचल term (रमेश)', () => {
            expect(LABOUR_MOCK.people.ramesh.balance.advance).toBeGreaterThan(0);
            render(<PersonDetail {...baseProps()} personId="ramesh" />);
            expect(screen.queryByText(/कामाचे पैसे ₹/)).toBeNull();
        });
    });

    /*
     * TASK 22 (spec: 2026-08-28-labour-v2-release-1) — "X दिवस काम" is not
     * days worked. `daysActive` is computed server-side
     * (GetLabourDataHandler.cs) as
     * `farmLocalToday.DayNumber - FarmLocalDay.From(membership.GrantedAtUtc).DayNumber`
     * — days since the worker was ADDED to the farm — never days he actually
     * worked. It rendered right above the worker's money, where a farmer
     * reads it as "days he worked for me". No honest relabel word ("since
     * added"/"जोडल्यापासून" or similar) exists anywhere in this template or
     * the labour feature's other strings, so the fix is deletion, not a
     * reword — reported to the founder rather than inventing new copy.
     *
     * The same edit also closes a second, adjacent landmine: the bare
     * `{w.trust ? ' · विश्वासार्ह' : ''}` fragment on the same line asserted
     * a trust label completely ungated — unlike the dedicated विश्वास card
     * lower in this file, which Rule 6 (2026-08-10) already gates behind
     * `SHOW_TRUST_SCORE` because the backing ReliabilityScore is fabricated
     * (always 100). `Trust` is hardcoded `null` server-side today so this
     * never reaches a real farmer, but the mock (सुनीता: trust=76, used by
     * the dev preview) would have rendered it. Same doctrine, same flag.
     */
    describe('PersonDetail — no "X दिवस काम" claim, and no ungated trust label (Task 22)', () => {
        afterEach(() => cleanup());

        it('never renders "दिवस काम" next to a worker\'s name — daysActive is days since added, not days worked (रमेश: daysActive=27)', () => {
            render(<PersonDetail {...baseProps()} personId="ramesh" />);
            expect(screen.queryByText(/दिवस काम/)).toBeNull();
        });

        it('does not render a bare "विश्वासार्ह" trust label next to the name — SHOW_TRUST_SCORE governs any trust claim (सुनीता: trust=76)', () => {
            expect(LABOUR_MOCK.people.sunita.trust).toBe(76);
            render(<PersonDetail {...baseProps()} personId="sunita" />);
            expect(screen.queryByText(/विश्वासार्ह/)).toBeNull();
        });
    });
});
