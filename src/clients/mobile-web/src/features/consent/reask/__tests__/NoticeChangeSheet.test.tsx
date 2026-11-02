// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-13, D-36)
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockLanguage: 'mr' | 'en' = 'mr';
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: mockLanguage, setLanguage: () => undefined, t: (k: string) => k }),
}));

vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: {
        getConsent: vi.fn(),
        getImprovementPermission: vi.fn(),
        setImprovementPermission: vi.fn(),
    },
}));

vi.mock('../noticeReacceptance', () => ({
    needsNoticeReacceptance: vi.fn(),
    recordNoticeReacceptance: vi.fn(),
    flushNoticeReacceptance: vi.fn(),
}));

import NoticeChangeSheet from '../NoticeChangeSheet';
import { agriSyncClient } from '../../../../infrastructure/api/AgriSyncClient';
import { flushNoticeReacceptance, needsNoticeReacceptance, recordNoticeReacceptance } from '../noticeReacceptance';
import { IMPROVEMENT_COPY, IMPROVEMENT_WORDING_VERSION } from '../../improvement/improvementPermissionCopy';

const client = agriSyncClient as unknown as {
    getConsent: ReturnType<typeof vi.fn>;
    getImprovementPermission: ReturnType<typeof vi.fn>;
    setImprovementPermission: ReturnType<typeof vi.fn>;
};
const needs = vi.mocked(needsNoticeReacceptance);
const record = vi.mocked(recordNoticeReacceptance);
const flush = vi.mocked(flushNoticeReacceptance);

const D36_MR = 'तुमच्या स्वतंत्र परवानगीशिवाय तुमच्या आवाजाच्या नोंदी श्रमसफलची भाषा व काम समजण्याची क्षमता सुधारण्यासाठी वापरल्या जाणार नाहीत.';

const improvementDto = (allowed: boolean) => ({
    allowed,
    wordingVersion: allowed ? IMPROVEMENT_WORDING_VERSION : null,
    chosenAtUtc: allowed ? '2026-10-30T06:00:00Z' : null,
    currentWordingVersion: IMPROVEMENT_WORDING_VERSION,
    allowedUnderCurrentWording: allowed,
});

beforeEach(() => {
    vi.resetAllMocks();
    mockLanguage = 'mr';
    flush.mockResolvedValue('nothing-pending');
    record.mockResolvedValue('queued');
    client.getImprovementPermission.mockResolvedValue(improvementDto(false));
    client.setImprovementPermission.mockImplementation(async ({ allowed }: { allowed: boolean }) => improvementDto(allowed));
});
afterEach(cleanup);

const box = () => screen.getByTestId('improvement-permission-checkbox');
const tick = () => fireEvent.click(screen.getByTestId('consent-tick'));
const cont = () => fireEvent.click(screen.getByTestId('notice-change-continue'));
const closed = () => waitFor(() => expect(screen.queryByTestId('notice-change-sheet')).toBeNull());

/** Open the sheet and wait until the improvement read has settled (the switch is live). */
async function openAsked() {
    needs.mockResolvedValue(true);
    render(<NoticeChangeSheet userId="u-1" />);
    await screen.findByTestId('notice-change-sheet');
    await waitFor(() => expect(box()).toBeEnabled());
}

describe('NoticeChangeSheet', () => {
    it('shows nothing when he does not need to be asked', async () => {
        needs.mockResolvedValue(false);
        render(<NoticeChangeSheet userId="u-1" />);
        await waitFor(() => expect(needs).toHaveBeenCalled());
        expect(screen.queryByTestId('notice-change-sheet')).toBeNull();
        expect(flush).toHaveBeenCalled();
    });

    it('asks once: the founder’s changed promise, the improvement switch, Continue held until ticked', async () => {
        await openAsked();
        expect(screen.getByTestId('notice-change-promise')).toHaveTextContent(D36_MR);
        // lane F99 fix pass 2 (D-71, material): the erasure line he now ticks, word for word.
        expect(screen.getByTestId('notice-change-erasure')).toHaveTextContent(
            'खातं आणि माहिती मिटवायची विनंती करा. विनंतीनंतर ३० दिवस काहीही मिटवलं जात नाही आणि तोपर्यंत ती रद्द करता येते.');
        expect(screen.getByTestId('notice-change-sheet')).toHaveTextContent('माहिती वापराची सूचना बदलली आहे. त्यातले मुख्य बदल असे:');
        expect(box()).not.toBeChecked();
        expect(screen.getByText(IMPROVEMENT_COPY.mr.title)).toBeInTheDocument();
        expect(screen.getByText(IMPROVEMENT_COPY.mr.body)).toBeInTheDocument();
        expect(screen.getByTestId('notice-change-continue')).toBeDisabled();
        // Marathi mode shows Marathi only.
        expect(screen.getByTestId('notice-change-sheet').textContent ?? '').not.toMatch(/[A-Za-z]{4,}/);
        tick();
        expect(screen.getByTestId('notice-change-continue')).toBeEnabled();
    });

    // ── P10: the network never holds him ─────────────────────────────────

    it('closes as soon as the acceptance is on the phone (the send is not awaited)', async () => {
        await openAsked();
        tick();
        cont();
        await closed();
        expect(record).toHaveBeenCalledWith('mr');
    });

    it('when the phone could hold nothing and the send failed: shows the failure, keeps the button live, and a retry closes it', async () => {
        record.mockResolvedValueOnce('failed').mockResolvedValueOnce('queued');
        await openAsked();
        tick();
        cont();
        expect(await screen.findByTestId('notice-change-accept-failed')).toBeInTheDocument();
        expect(screen.getByTestId('notice-change-sheet')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('notice-change-continue')).toBeEnabled());

        cont();
        await closed();
        expect(record).toHaveBeenCalledTimes(2);
    });

    // ── D-36: the switch never shows OFF while the server holds ON ───────

    it('server holds ON: the switch starts ON, and leaving it ON sends nothing', async () => {
        client.getImprovementPermission.mockResolvedValue(improvementDto(true));
        await openAsked();
        await waitFor(() => expect(box()).toBeChecked());
        tick();
        cont();
        await closed();
        expect(client.setImprovementPermission).not.toHaveBeenCalled();
    });

    it('server holds ON and he turns it OFF: the withdrawal is sent', async () => {
        client.getImprovementPermission.mockResolvedValue(improvementDto(true));
        await openAsked();
        await waitFor(() => expect(box()).toBeChecked());
        fireEvent.click(box());
        tick();
        cont();
        await closed();
        expect(client.setImprovementPermission).toHaveBeenCalledWith({
            allowed: false, wordingVersion: IMPROVEMENT_WORDING_VERSION, languageShown: 'mr',
        });
    });

    it('server holds OFF and he turns it ON: the permission is sent with the words he saw', async () => {
        await openAsked();
        fireEvent.click(box());
        tick();
        cont();
        await closed();
        expect(client.setImprovementPermission).toHaveBeenCalledWith({
            allowed: true, wordingVersion: IMPROVEMENT_WORDING_VERSION, languageShown: 'mr',
        });
    });

    it('server state UNKNOWN and he leaves it OFF: one immediate best-effort OFF, and the sheet does not wait for it', async () => {
        client.getImprovementPermission.mockRejectedValue(new Error('offline'));
        client.setImprovementPermission.mockImplementation(() => new Promise(() => { /* stalls */ }));
        await openAsked();
        expect(box()).not.toBeChecked();
        tick();
        cont();
        await closed();
        expect(client.setImprovementPermission).toHaveBeenCalledTimes(1);
        expect(client.setImprovementPermission).toHaveBeenCalledWith({
            allowed: false, wordingVersion: IMPROVEMENT_WORDING_VERSION, languageShown: 'mr',
        });
    });

    it('server state UNKNOWN and he turns it ON: the permission is sent', async () => {
        client.getImprovementPermission.mockRejectedValue(new Error('offline'));
        await openAsked();
        fireEvent.click(box());
        tick();
        cont();
        await closed();
        expect(client.setImprovementPermission).toHaveBeenCalledWith({
            allowed: true, wordingVersion: IMPROVEMENT_WORDING_VERSION, languageShown: 'mr',
        });
    });

    it('if a changed choice does not reach the server it says so, shows what the server holds, and lets him go on', async () => {
        client.setImprovementPermission.mockRejectedValue(new Error('offline'));
        await openAsked();
        fireEvent.click(box());
        tick();
        cont();

        expect(await screen.findByTestId('improvement-permission-save-failed')).toHaveTextContent(IMPROVEMENT_COPY.mr.saveFailed);
        expect(box()).not.toBeChecked();
        expect(record).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('notice-change-ok'));
        expect(screen.queryByTestId('notice-change-sheet')).toBeNull();
    });

    it('English mode shows English only', async () => {
        mockLanguage = 'en';
        await openAsked();
        expect(screen.getByTestId('notice-change-sheet').textContent ?? '').not.toMatch(/[ऀ-ॿ]/);
    });
});
