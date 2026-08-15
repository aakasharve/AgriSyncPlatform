// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope, D4 — Task 6.
 *
 * The shared honest surface every harvest entry point now renders instead of
 * the broken sale/config flow.
 *
 * FIX ROUND 1 — the original copy said "anything you already noted down here
 * is still on your phone; it has not been deleted", which independent review
 * proved false: grade-wise sale data (quantities, grades, prices, income,
 * payment status) was NEVER written by any code path, so there was no
 * evidence a farmer's past sale was "still there". The corrected copy makes
 * only the evidenced claim — this change deletes nothing — and says nothing
 * about what a past entry currently contains. This suite pins the CORRECTED
 * claim positively (not merely "some reassuring text exists") and separately
 * asserts the specific false phrasing does not reappear, so a future edit
 * that quietly restores it fails here rather than reaching a farmer.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import HarvestComingSoon from '../HarvestComingSoon';

afterEach(() => {
    cleanup();
});

describe('HarvestComingSoon', () => {
    it('renders the honest "not built yet" message', () => {
        render(<HarvestComingSoon />);
        expect(screen.getByTestId('harvest-coming-soon')).toBeInTheDocument();
        expect(screen.getByText(/harvest tracking is coming soon/i)).toBeInTheDocument();
        expect(screen.getByText(/isn't built yet/i)).toBeInTheDocument();
    });

    it('says plainly that a harvest sale would not be saved', () => {
        render(<HarvestComingSoon />);
        expect(screen.getByText(/would not be saved to your farm records/i)).toBeInTheDocument();
    });

    it('makes only the evidenced claim: this change deletes nothing', () => {
        render(<HarvestComingSoon />);
        expect(screen.getByText(/nothing on your phone has been deleted/i)).toBeInTheDocument();
    });

    it('does NOT claim past harvest sale data is safe, kept, or retrievable', () => {
        // Fix round 1 regression guard: the false claim this fixed was exactly
        // "anything you already noted down here is still on your phone; it
        // has not been deleted" — an unevidenced promise about a sale that
        // was never written in the first place. Pin its absence by the exact
        // phrases that made it false, not by a vague "sounds reassuring"
        // check that a reworded false claim could still pass.
        render(<HarvestComingSoon />);
        const text = screen.getByTestId('harvest-coming-soon').textContent || '';
        expect(text).not.toMatch(/already noted down/i);
        expect(text).not.toMatch(/still on your phone/i);
        expect(text).not.toMatch(/your (records|sale)s? (is|are) (safe|kept|fine)/i);
    });

    it('promises no date', () => {
        render(<HarvestComingSoon />);
        const text = screen.getByTestId('harvest-coming-soon').textContent || '';
        // No month names, no "soon on", no explicit calendar reference beyond
        // the generic "coming soon" heading itself.
        expect(text).not.toMatch(/january|february|march|april|may|june|july|august|september|october|november|december/i);
        expect(text).not.toMatch(/\b\d{4}\b/); // no year
        expect(text).not.toMatch(/\bweek(s)?\b/i);
    });

    it('offers no control that could start a new harvest write', () => {
        render(<HarvestComingSoon />);
        expect(screen.queryAllByRole('button')).toHaveLength(0);
        expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    });
});
