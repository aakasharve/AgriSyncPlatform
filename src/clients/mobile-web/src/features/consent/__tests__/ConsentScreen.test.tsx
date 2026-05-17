// @vitest-environment jsdom
// spec: data-principle-spine-2026-05-05/06.4
//
// ConsentScreen rendering + Save flow. Two tests per envelope:
//   1. All three toggles render OFF by default (no prior state).
//   2. Save button calls `updateConsent` with the new state.
//
// Per repo convention (see OfflineConflictPage.test.tsx + the original
// AiTestModeBanner test): global vitest env stays 'node'; this file
// opts into jsdom via the directive above and imports jest-dom
// matchers per-file.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the API client BEFORE importing the component under test.
vi.mock('../../../infrastructure/api/AgriSyncClient', () => {
    return {
        agriSyncClient: {
            getConsent: vi.fn(),
            updateConsent: vi.fn(),
        },
    };
});

// LanguageContext relies on Dexie; replace with a stub so we don't drag
// IndexedDB into a jsdom unit test.
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ConsentScreen from '../ConsentScreen';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { LEGAL_REVIEW_PENDING_PREFIX } from '../../../i18n/legalReviewMarker';

const mockedClient = agriSyncClient as unknown as {
    getConsent: ReturnType<typeof vi.fn>;
    updateConsent: ReturnType<typeof vi.fn>;
};

describe('ConsentScreen', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Empty fetch so the agreement renderer doesn't try to hit the
        // network and noisily fail in jsdom.
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(''),
        }) as unknown as typeof fetch;
    });

    afterEach(() => {
        // Explicit cleanup so each test's render is torn down before
        // the next mounts. (Vitest's globals are off here, so the
        // auto-cleanup-on-afterEach hook in @testing-library/react
        // does not fire — see the library's vitest config note.)
        cleanup();
    });

    it('renders all three toggles OFF when there is no prior consent', async () => {
        // No prior state — backend returns a "no consent yet" 404 / reject.
        mockedClient.getConsent.mockRejectedValue(new Error('no consent'));

        render(<ConsentScreen forceLocale="en-IN" />);

        // Wait for the lazy/effect path to settle.
        const full = await screen.findByTestId('consent-checkbox-fullHistoryJournal');
        const cross = await screen.findByTestId('consent-checkbox-crossFarmAggregation');
        const research = await screen.findByTestId('consent-checkbox-researchCorpusExport');

        expect(full).not.toBeChecked();
        expect(cross).not.toBeChecked();
        expect(research).not.toBeChecked();

        // Per OQ-7 i18n convention: visible strings carry the
        // [LEGAL_REVIEW_PENDING] runtime prefix until counsel strips it.
        expect(screen.getByTestId('consent-save-button').textContent ?? '').toContain(
            LEGAL_REVIEW_PENDING_PREFIX,
        );
    });

    it('Save button calls updateConsent with the new state', async () => {
        mockedClient.getConsent.mockResolvedValue({
            fullHistoryJournal: false,
            crossFarmAggregation: false,
            researchCorpusExport: false,
            version: 1,
            acceptedAtUtc: null,
            revokedAtUtc: null,
        });
        mockedClient.updateConsent.mockResolvedValue({
            fullHistoryJournal: true,
            crossFarmAggregation: false,
            researchCorpusExport: true,
            version: 1,
            acceptedAtUtc: '2026-05-17T00:00:00.000Z',
            revokedAtUtc: null,
        });

        render(<ConsentScreen forceLocale="en-IN" />);

        // Toggle the first + third checkboxes on, leave the second off.
        const full = await screen.findByTestId('consent-checkbox-fullHistoryJournal');
        const research = await screen.findByTestId('consent-checkbox-researchCorpusExport');
        fireEvent.click(full);
        fireEvent.click(research);

        // Click Save.
        const saveBtn = screen.getByTestId('consent-save-button');
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockedClient.updateConsent).toHaveBeenCalledTimes(1);
        });

        const callArg = mockedClient.updateConsent.mock.calls[0][0];
        expect(callArg.fullHistoryJournal).toBe(true);
        expect(callArg.crossFarmAggregation).toBe(false);
        expect(callArg.researchCorpusExport).toBe(true);
        expect(callArg.languageShown).toBe('en-IN');
        expect(typeof callArg.consentTextVersion).toBe('number');
        expect(typeof callArg.clientAppVersion).toBe('string');
    });
});
