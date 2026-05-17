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

import ExportRequestScreen from '../ExportRequestScreen';
import { LEGAL_REVIEW_PENDING_PREFIX } from '../../../i18n/legalReviewMarker';

describe('ExportRequestScreen', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });
    afterEach(() => {
        cleanup();
    });

    it('renders the submit button with LEGAL_REVIEW_PENDING-tagged copy', async () => {
        render(<ExportRequestScreen forceLocale="en-IN" />);
        const btn = await screen.findByTestId('export-submit-button');
        expect(btn.textContent ?? '').toContain(LEGAL_REVIEW_PENDING_PREFIX);
    });

    it('Submit calls the injected submitFn and shows the 24h SLA copy on success', async () => {
        const submitFn = vi.fn().mockResolvedValue({ requestId: 'r-456' });
        render(<ExportRequestScreen forceLocale="en-IN" submitFn={submitFn} />);
        fireEvent.click(await screen.findByTestId('export-submit-button'));
        await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));
        const sla = await screen.findByTestId('export-success-sla');
        expect(sla.textContent ?? '').toContain(LEGAL_REVIEW_PENDING_PREFIX);
        expect(sla.textContent ?? '').toContain('24 hours');
    });
});
