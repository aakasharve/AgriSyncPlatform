// @vitest-environment jsdom
// spec: voice-diary-e2e-2026-05-17 (D.21)
//
// VoiceRetainedConsentToggle — first-grant flow + revoke flow.
//
//   1. Initial OFF state → user toggles ON → first-grant banner opens
//      (the banner is the explicit attestation surface).
//   2. Banner confirm → updateConsent called with fullHistoryJournal: true.
//   3. spec: dfes-companion-2026-07-11 (farm-memory) — ADR-DS-017 (c).
//      With consent already granted, toggling OFF must NOT post on the
//      first tap. It opens a confirmation that says what stopping does
//      and, more to the point, what it does not do.
//
//      This case previously asserted the opposite — "toggling OFF after a
//      prior grant posts directly without showing the banner". That was a
//      faithful description of the code and a description of the defect:
//      one careless tap sent an irreversible-looking revocation with no
//      statement of consequence, while the far safer ON direction was
//      gated behind an attestation modal. The founder's 2026-08-23 ruling
//      makes stopping future capture and deleting saved history two
//      deliberate actions, so the old expectation had to be replaced
//      rather than relaxed. The replacement is strictly stronger: it
//      pins that NOTHING reaches the server until confirmation, that
//      dismissing leaves the server untouched, and that the farmer is
//      told his history is kept.
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

    async function renderWithConsentOn() {
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
        return checkbox;
    }

    it('toggling OFF opens a confirmation and posts nothing until it is confirmed', async () => {
        const checkbox = await renderWithConsentOn();

        fireEvent.click(checkbox);

        const banner = await screen.findByTestId('voice-retained-stop-future-banner');
        expect(banner).toBeInTheDocument();
        expect(mockedClient.updateConsent).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('voice-retained-stop-future-confirm'));

        await waitFor(() => {
            expect(mockedClient.updateConsent).toHaveBeenCalledTimes(1);
        });
        const [calledWith] = mockedClient.updateConsent.mock.calls[0];
        expect(calledWith).toMatchObject({ fullHistoryJournal: false });
    });

    it('the OFF confirmation tells the farmer his saved history is kept, not deleted', async () => {
        const checkbox = await renderWithConsentOn();

        fireEvent.click(checkbox);

        await screen.findByTestId('voice-retained-stop-future-banner');

        // The whole reason this modal exists. A confirmation that only
        // asked "are you sure?" would leave the farmer exactly as unable
        // to tell "stop saving" from "delete everything" as the bare
        // checkbox did.
        const keptNote = screen.getByTestId('voice-retained-stop-future-kept-note');
        expect(keptNote).toHaveTextContent(/already saved stays/i);
        expect(keptNote).toHaveTextContent(/separate action/i);
    });

    it('dismissing the OFF confirmation leaves the server untouched', async () => {
        const checkbox = await renderWithConsentOn();

        fireEvent.click(checkbox);
        await screen.findByTestId('voice-retained-stop-future-banner');

        fireEvent.click(screen.getByTestId('voice-retained-stop-future-dismiss'));

        await waitFor(() => {
            expect(screen.queryByTestId('voice-retained-stop-future-banner')).toBeNull();
        });
        expect(mockedClient.updateConsent).not.toHaveBeenCalled();
        // The checkbox is driven by server state, which never changed, so
        // a dismissed mis-tap must leave it visibly ON.
        expect(screen.getByTestId('voice-retained-consent-checkbox')).toBeChecked();
    });
});
