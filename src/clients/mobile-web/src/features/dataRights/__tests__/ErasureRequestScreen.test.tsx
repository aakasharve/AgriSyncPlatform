// @vitest-environment jsdom
// spec: data-principle-spine-2026-05-05/08.6

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ErasureRequestScreen from '../ErasureRequestScreen';
import { LEGAL_REVIEW_PENDING_PREFIX } from '../../../i18n/legalReviewMarker';

describe('ErasureRequestScreen', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });
    afterEach(() => {
        cleanup();
    });

    it('renders the open-confirm button with LEGAL_REVIEW_PENDING-tagged copy', async () => {
        render(<ErasureRequestScreen forceLocale="en-IN" />);
        const btn = await screen.findByTestId('erasure-open-confirm');
        expect(btn.textContent ?? '').toContain(LEGAL_REVIEW_PENDING_PREFIX);
    });

    it('Submit calls the injected submitFn and shows the 48h SLA copy on success', async () => {
        const submitFn = vi.fn().mockResolvedValue({ requestId: 'r-123' });
        render(<ErasureRequestScreen forceLocale="en-IN" submitFn={submitFn} />);

        // Open the confirm dialog, then confirm.
        const open = await screen.findByTestId('erasure-open-confirm');
        fireEvent.click(open);
        const confirm = await screen.findByTestId('erasure-confirm-submit');
        fireEvent.click(confirm);

        await waitFor(() => {
            expect(submitFn).toHaveBeenCalledTimes(1);
        });

        const sla = await screen.findByTestId('erasure-success-sla');
        expect(sla.textContent ?? '').toContain(LEGAL_REVIEW_PENDING_PREFIX);
        expect(sla.textContent ?? '').toContain('48 hours');
    });
});
