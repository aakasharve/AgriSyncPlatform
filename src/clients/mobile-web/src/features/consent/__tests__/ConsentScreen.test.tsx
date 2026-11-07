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
            getImprovementPermission: vi.fn(),
            setImprovementPermission: vi.fn(),
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
import { peekPlaybackSwitch, resetPlaybackSwitchForTests } from '../../logs/components/voiceResult/playbackSwitch';

const mockedClient = agriSyncClient as unknown as {
    getConsent: ReturnType<typeof vi.fn>;
    updateConsent: ReturnType<typeof vi.fn>;
    getImprovementPermission: ReturnType<typeof vi.fn>;
    setImprovementPermission: ReturnType<typeof vi.fn>;
};

const IMPROVE = 'improve-2026-10-30.1';
const improvementDto = (allowed: boolean, wordingVersion: string | null = allowed ? IMPROVE : null) => ({
    allowed,
    wordingVersion,
    chosenAtUtc: allowed ? '2026-10-30T06:00:00Z' : null,
    currentWordingVersion: IMPROVE,
    allowedUnderCurrentWording: allowed && wordingVersion === IMPROVE,
});

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
        mockedClient.getImprovementPermission.mockResolvedValue(improvementDto(false));

        render(<ConsentScreen forceLocale="en-IN" />);

        const full = await screen.findByTestId('consent-checkbox-fullHistoryJournal');
        const improvement = await screen.findByTestId('improvement-permission-checkbox');
        const research = await screen.findByTestId('consent-checkbox-researchCorpusExport');

        expect(full).not.toBeChecked();
        expect(improvement).not.toBeChecked();
        expect(research).not.toBeChecked();
        // D-36: the old ambiguous "improve the app" switch is not drawn any more.
        expect(screen.queryByTestId('consent-checkbox-crossFarmAggregation')).toBeNull();

        // No internal review marker is rendered to the user.
        expect(screen.getByTestId('consent-save-button').textContent ?? '').not.toContain(
            'LEGAL_REVIEW' + '_PENDING',
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

        mockedClient.getImprovementPermission.mockResolvedValue(improvementDto(false));

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
        // The retired switch is left as it is, never re-sent.
        expect(callArg).not.toHaveProperty('crossFarmAggregation');
        expect(callArg.researchCorpusExport).toBe(true);
        expect(callArg.languageShown).toBe('en-IN');
        expect(typeof callArg.consentTextVersion).toBe('number');
        expect(typeof callArg.clientAppVersion).toBe('string');
        // D-31: the "keep my original voice" choice was made, so the words are named.
        expect(callArg.fullHistoryJournalWordingVersion).toBe('voice-keep-2026-11-06.1');
        // D-36: the improvement permission did not change, so nothing is sent for it.
        expect(mockedClient.setImprovementPermission).not.toHaveBeenCalled();
    });

    it('the voice switch shows its D-31 meaning: me and authorised reviewers on this farm', async () => {
        mockedClient.getConsent.mockRejectedValue(new Error('no consent'));
        mockedClient.getImprovementPermission.mockResolvedValue(improvementDto(false));
        render(<ConsentScreen forceLocale="en-IN" />);
        expect(await screen.findByTestId('consent-meaning-fullHistoryJournal')).toHaveTextContent(
            'Allow me and authorized reviewers on this farm to play back my original voice.',
        );
    });

    it('saving without touching the voice switch does not claim new words for it', async () => {
        mockedClient.getConsent.mockResolvedValue({
            fullHistoryJournal: true, crossFarmAggregation: false, researchCorpusExport: false,
            version: 1, acceptedAtUtc: null, revokedAtUtc: null,
        });
        mockedClient.getImprovementPermission.mockResolvedValue(improvementDto(false));
        mockedClient.updateConsent.mockResolvedValue({
            fullHistoryJournal: true, crossFarmAggregation: false, researchCorpusExport: true,
            version: 1, acceptedAtUtc: null, revokedAtUtc: null,
        });
        render(<ConsentScreen forceLocale="en-IN" />);
        fireEvent.click(await screen.findByTestId('consent-checkbox-researchCorpusExport'));
        fireEvent.click(screen.getByTestId('consent-save-button'));
        await waitFor(() => expect(mockedClient.updateConsent).toHaveBeenCalledTimes(1));
        expect(mockedClient.updateConsent.mock.calls[0][0]).not.toHaveProperty('fullHistoryJournalWordingVersion');
    });

    it('D-36: the improvement switch is OFF by default and turning it on saves its own record with its words', async () => {
        mockedClient.getConsent.mockRejectedValue(new Error('no consent'));
        mockedClient.getImprovementPermission.mockResolvedValue(improvementDto(false));
        mockedClient.updateConsent.mockResolvedValue({
            fullHistoryJournal: false, crossFarmAggregation: false, researchCorpusExport: false,
            version: 1, acceptedAtUtc: null, revokedAtUtc: null,
        });
        mockedClient.setImprovementPermission.mockResolvedValue(improvementDto(true));

        render(<ConsentScreen forceLocale="mr-IN" />);
        const box = await screen.findByTestId('improvement-permission-checkbox');
        await waitFor(() => expect(box).toBeEnabled());
        expect(box).not.toBeChecked();
        fireEvent.click(box);
        fireEvent.click(screen.getByTestId('consent-save-button'));

        await waitFor(() => expect(mockedClient.setImprovementPermission).toHaveBeenCalledTimes(1));
        expect(mockedClient.setImprovementPermission).toHaveBeenCalledWith({
            allowed: true, wordingVersion: IMPROVE, languageShown: 'mr',
        });
        await waitFor(() => expect(box).toBeChecked());
    });

    it('D-36: an ON given against OTHER words is shown OFF — he has not agreed to these words', async () => {
        mockedClient.getConsent.mockRejectedValue(new Error('no consent'));
        mockedClient.getImprovementPermission.mockResolvedValue(improvementDto(true, 'improve-2020-01-01.1'));
        render(<ConsentScreen forceLocale="en-IN" />);
        const box = await screen.findByTestId('improvement-permission-checkbox');
        await waitFor(() => expect(box).toBeEnabled());
        expect(box).not.toBeChecked();
    });

    const revokeAll = async () => {
        fireEvent.click(await screen.findByTestId('consent-revoke-all-button'));
        fireEvent.click(await screen.findByTestId('consent-revoke-confirm-button'));
    };

    it('fix round 4 (L1, D-101): a save publishes the new switch state to the phone at once; turning it OFF blocks playback now', async () => {
        resetPlaybackSwitchForTests();
        const dto = (on: boolean) => ({
            fullHistoryJournal: on, crossFarmAggregation: false, researchCorpusExport: false,
            version: 1, acceptedAtUtc: '2026-05-17T00:00:00.000Z', revokedAtUtc: null,
        });
        mockedClient.getConsent.mockResolvedValue(dto(true));
        mockedClient.getImprovementPermission.mockResolvedValue(improvementDto(false));
        mockedClient.updateConsent.mockResolvedValue(dto(false));

        render(<ConsentScreen forceLocale="en-IN" />);
        fireEvent.click(await screen.findByTestId('consent-checkbox-fullHistoryJournal'));
        fireEvent.click(screen.getByTestId('consent-save-button'));

        await waitFor(() => expect(mockedClient.updateConsent).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(peekPlaybackSwitch()).toBe(false));
    });

    it('Revoke All sends improvement OFF even when the page could not read the stored choice', async () => {
        mockedClient.getConsent.mockRejectedValue(new Error('no consent'));
        mockedClient.getImprovementPermission.mockRejectedValue(new Error('offline at load'));
        mockedClient.updateConsent.mockResolvedValue({
            fullHistoryJournal: false, crossFarmAggregation: false, researchCorpusExport: false,
            version: 1, acceptedAtUtc: null, revokedAtUtc: null,
        });
        mockedClient.setImprovementPermission.mockResolvedValue(improvementDto(false, IMPROVE));

        render(<ConsentScreen forceLocale="en-IN" />);
        await screen.findByTestId('improvement-permission-checkbox');
        await revokeAll();

        await waitFor(() => expect(mockedClient.setImprovementPermission).toHaveBeenCalledTimes(1));
        expect(mockedClient.setImprovementPermission).toHaveBeenCalledWith({
            allowed: false, wordingVersion: IMPROVE, languageShown: 'en',
        });
        expect(mockedClient.updateConsent.mock.calls[0][0]).toMatchObject({
            fullHistoryJournal: false, crossFarmAggregation: false, researchCorpusExport: false,
        });
        expect(await screen.findByTestId('consent-save-status')).toHaveTextContent('Consent saved.');
    });

    it('Revoke All whose improvement OFF does not reach the server shows the failure, never the success line', async () => {
        mockedClient.getConsent.mockRejectedValue(new Error('no consent'));
        mockedClient.getImprovementPermission.mockResolvedValue(improvementDto(true));
        mockedClient.updateConsent.mockResolvedValue({
            fullHistoryJournal: false, crossFarmAggregation: false, researchCorpusExport: false,
            version: 1, acceptedAtUtc: null, revokedAtUtc: null,
        });
        mockedClient.setImprovementPermission.mockRejectedValue(new Error('503'));

        render(<ConsentScreen forceLocale="en-IN" />);
        await waitFor(() => expect(screen.getByTestId('improvement-permission-checkbox')).toBeChecked());
        await revokeAll();

        const status = await screen.findByTestId('consent-save-status');
        await waitFor(() => expect(status).toHaveTextContent('Could not save. Please try again.'));
        expect(status).not.toHaveTextContent('Consent saved.');
    });

    it('when the stored improvement choice cannot be read, its switch is held rather than showing a false OFF', async () => {
        mockedClient.getConsent.mockRejectedValue(new Error('no consent'));
        mockedClient.getImprovementPermission.mockRejectedValue(new Error('offline'));
        render(<ConsentScreen forceLocale="en-IN" />);
        expect(await screen.findByTestId('improvement-permission-checkbox')).toBeDisabled();
    });
});
