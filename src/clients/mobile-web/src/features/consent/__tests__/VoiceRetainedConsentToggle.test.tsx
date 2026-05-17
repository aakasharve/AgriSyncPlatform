// @vitest-environment jsdom
// spec: voice-diary-e2e-2026-05-17 (D.21)
//
// VoiceRetainedConsentToggle — first-grant flow + revoke flow.
//
//   1. Initial OFF state → user toggles ON → first-grant banner opens
//      (the banner is the explicit attestation surface).
//   2. Banner confirm → updateConsent called with fullHistoryJournal: true.
//   3. With consent already granted, toggling OFF posts directly (no
//      banner intercept).
//
// Mocks: AgriSyncClient (getConsent / updateConsent) + LanguageContext
// stub identical to ConsentScreen.test.tsx.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: {
        getConsent: vi.fn(),
        updateConsent: vi.fn(),
    },
}));

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import VoiceRetainedConsentToggle from '../VoiceRetainedConsentToggle';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';

const mockedClient = agriSyncClient as unknown as {
    getConsent: ReturnType<typeof vi.fn>;
    updateConsent: ReturnType<typeof vi.fn>;
};

const defaultConsentDto = {
    fullHistoryJournal: false,
    crossFarmAggregation: false,
    researchCorpusExport: false,
    version: 1,
    acceptedAtUtc: null,
    revokedAtUtc: null,
};

describe('VoiceRetainedConsentToggle', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('opens the first-grant banner when the user toggles ON for the first time', async () => {
        mockedClient.getConsent.mockResolvedValue(defaultConsentDto);
        mockedClient.updateConsent.mockResolvedValue({
            ...defaultConsentDto,
            fullHistoryJournal: true,
            acceptedAtUtc: new Date().toISOString(),
        });

        render(<VoiceRetainedConsentToggle locale="en-IN" />);

        const checkbox = await screen.findByTestId('voice-retained-consent-checkbox');
        expect(checkbox).not.toBeChecked();

        fireEvent.click(checkbox);

        // Banner intercepts — updateConsent NOT called yet.
        const banner = await screen.findByTestId('voice-retained-first-grant-banner');
        expect(banner).toBeInTheDocument();
        expect(mockedClient.updateConsent).not.toHaveBeenCalled();

        // Confirm in the banner → updateConsent posts the grant.
        fireEvent.click(screen.getByTestId('voice-retained-first-grant-confirm'));

        await waitFor(() => {
            expect(mockedClient.updateConsent).toHaveBeenCalledTimes(1);
        });
        const [calledWith] = mockedClient.updateConsent.mock.calls[0];
        expect(calledWith).toMatchObject({ fullHistoryJournal: true, languageShown: 'en-IN' });
    });

    it('toggling OFF after a prior grant posts directly without showing the banner', async () => {
        mockedClient.getConsent.mockResolvedValue({
            ...defaultConsentDto,
            fullHistoryJournal: true,
            acceptedAtUtc: new Date().toISOString(),
        });
        mockedClient.updateConsent.mockResolvedValue({
            ...defaultConsentDto,
            fullHistoryJournal: false,
            revokedAtUtc: new Date().toISOString(),
        });

        render(<VoiceRetainedConsentToggle locale="en-IN" />);

        const checkbox = await screen.findByTestId('voice-retained-consent-checkbox');
        await waitFor(() => expect(checkbox).toBeChecked());

        fireEvent.click(checkbox);

        // No banner — direct PUT.
        await waitFor(() => {
            expect(mockedClient.updateConsent).toHaveBeenCalledTimes(1);
        });
        expect(screen.queryByTestId('voice-retained-first-grant-banner')).toBeNull();
        const [calledWith] = mockedClient.updateConsent.mock.calls[0];
        expect(calledWith).toMatchObject({ fullHistoryJournal: false });
    });
});
