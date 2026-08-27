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
});
