// @vitest-environment jsdom
// spec: voice-diary-e2e-2026-05-17 (D.21)
//
// RetentionBanner — both consent states.
//
//   1. granted=true  → emerald "kept in cloud" banner; no CTA button.
//   2. granted=false → amber "30 days only" banner; CTA visible + click
//      invokes the onOpenSettings handler.
//
// Mirrors `ConsentScreen.test.tsx` patterns (per-file jsdom + jest-dom
// matchers; explicit cleanup so renders are torn down between tests).

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import RetentionBanner from '../components/RetentionBanner';
import { LEGAL_REVIEW_PENDING_PREFIX } from '../../../i18n/legalReviewMarker';

describe('RetentionBanner', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders the granted-state banner when consent is on', () => {
        render(<RetentionBanner locale="en-IN" granted={true} />);
        const banner = screen.getByTestId('voice-diary-retention-banner-granted');
        expect(banner).toBeInTheDocument();
        // No CTA in the granted state.
        expect(screen.queryByTestId('voice-diary-retention-banner-cta')).toBeNull();
        // LEGAL_REVIEW_PENDING marker surfaces in every visible string.
        expect(banner.textContent ?? '').toContain(LEGAL_REVIEW_PENDING_PREFIX);
    });

    it('renders the denied-state banner with a CTA when consent is off', () => {
        const onOpenSettings = vi.fn();
        render(<RetentionBanner locale="en-IN" granted={false} onOpenSettings={onOpenSettings} />);

        const banner = screen.getByTestId('voice-diary-retention-banner-denied');
        expect(banner).toBeInTheDocument();
        expect(banner.textContent ?? '').toContain(LEGAL_REVIEW_PENDING_PREFIX);

        const cta = screen.getByTestId('voice-diary-retention-banner-cta');
        expect(cta).toBeInTheDocument();
        fireEvent.click(cta);
        expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('omits the CTA in the denied state when no handler is provided', () => {
        render(<RetentionBanner locale="en-IN" granted={false} />);
        expect(screen.getByTestId('voice-diary-retention-banner-denied')).toBeInTheDocument();
        expect(screen.queryByTestId('voice-diary-retention-banner-cta')).toBeNull();
    });
});
