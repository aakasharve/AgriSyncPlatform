// @vitest-environment jsdom
// spec: voice-diary-e2e-2026-05-17 (D.21)
//
// EmptyStatePrompt — renders when consent is OFF AND no local clips.
// Verifies the CTA invokes onOpenSettings and that no internal review
// marker is rendered.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import EmptyStatePrompt from '../components/EmptyStatePrompt';

describe('EmptyStatePrompt', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders the empty-state card without any review marker', () => {
        render(<EmptyStatePrompt locale="en-IN" onOpenSettings={() => undefined} />);
        const root = screen.getByTestId('voice-diary-empty-state');
        expect(root).toBeInTheDocument();
        expect(root.textContent ?? '').not.toContain('LEGAL_REVIEW' + '_PENDING');
    });

    it('invokes onOpenSettings when the CTA is clicked', () => {
        const onOpenSettings = vi.fn();
        render(<EmptyStatePrompt locale="en-IN" onOpenSettings={onOpenSettings} />);
        fireEvent.click(screen.getByTestId('voice-diary-empty-state-cta'));
        expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });
});
