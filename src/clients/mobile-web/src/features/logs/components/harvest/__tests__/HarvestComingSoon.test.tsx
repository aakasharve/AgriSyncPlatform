// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope, D4 — Task 6.
 *
 * The shared honest surface every harvest entry point now renders instead of
 * the broken sale/config flow. Covers: the message is present and says
 * plainly that the feature isn't built, it says existing records are kept
 * (not lost), it names no date, and — critically — it offers no control that
 * could start a new harvest write (no button, no input), because a farmer
 * who reaches "coming soon" must not find a door that still opens.
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

    it('reassures that anything already recorded is kept, not lost', () => {
        render(<HarvestComingSoon />);
        expect(screen.getByText(/still on your phone/i)).toBeInTheDocument();
        expect(screen.getByText(/has not been deleted/i)).toBeInTheDocument();
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
