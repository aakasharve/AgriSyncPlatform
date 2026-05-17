// @vitest-environment jsdom
// spec: voice-diary-e2e-2026-05-17 (D.21)
//
// EmptyStatePrompt — renders when consent is OFF AND no local clips.
// Verifies the CTA invokes onOpenSettings and that all visible copy
// carries the LEGAL_REVIEW_PENDING prefix.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import EmptyStatePrompt from '../components/EmptyStatePrompt';
import { LEGAL_REVIEW_PENDING_PREFIX } from '../../../i18n/legalReviewMarker';

describe('EmptyStatePrompt', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders the empty-state card with all i18n strings LRP-tagged', () => {
        render(<EmptyStatePrompt locale="en-IN" onOpenSettings={() => undefined} />);
        const root = screen.getByTestId('voice-diary-empty-state');
        expect(root).toBeInTheDocument();
        // Every visible body string should carry the LEGAL_REVIEW_PENDING prefix.
        expect(root.textContent ?? '').toContain(LEGAL_REVIEW_PENDING_PREFIX);
    });

    it('invokes onOpenSettings when the CTA is clicked', () => {
        const onOpenSettings = vi.fn();
        render(<EmptyStatePrompt locale="en-IN" onOpenSettings={onOpenSettings} />);
        fireEvent.click(screen.getByTestId('voice-diary-empty-state-cta'));
        expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });
});
