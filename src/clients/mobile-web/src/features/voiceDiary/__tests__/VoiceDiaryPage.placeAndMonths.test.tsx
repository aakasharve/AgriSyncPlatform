// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I17)
//
// The recordings place ("आवाज नोंदी", setup hub → आवाज नोंदी):
//   H19 — one title bar with one big मागे, and the same name as the hub row;
//   V-2 — plain Marathi: no "Voice Diary · सर्व नोंदी", no English second lines;
//   V-3 — a recording older than a month can be found and opened by paging back month by month
//         (the strip used to offer only the last 30 days, and an empty day snapped him back);
//   O8  — "keep my recordings" sits on this page; the banner's "चालू करा" opens that switch's own
//         turn-on confirmation instead of the leftover Settings page.
// Mocks stop at the page's boundaries (same set as VoiceDiaryPage.historySurvivesConsentOff).

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { getConsent: vi.fn(), updateConsent: vi.fn() },
}));
vi.mock('../../../infrastructure/voiceDiary/voiceDiaryApiClient', () => ({
    getVoiceDiaryByRange: vi.fn(),
    getVoiceDiaryById: vi.fn(),
}));
vi.mock('../../../infrastructure/sync/VoiceArchiveUploader', () => ({
    voiceArchiveUploader: { triggerNow: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn(() => () => undefined) },
}));
vi.mock('../../../infrastructure/voice/retainedClipReader', () => ({ openRetainedClip: vi.fn() }));
vi.mock('../../../infrastructure/voice/VoiceClipRetention', () => ({
    purgeExpiredProcessingVoiceClips: vi.fn().mockResolvedValue(undefined),
    readVoiceClipPlaintext: vi.fn(),
}));
vi.mock('../../../infrastructure/security/voiceEnvelope', () => ({ openVoiceClip: vi.fn() }));
vi.mock('../../../infrastructure/security/tenantDekClient', () => ({ resolveDek: vi.fn() }));
vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({ voiceClips: { toArray: async () => [] } }),
}));
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import VoiceDiaryPage from '../pages/VoiceDiaryPage';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { getVoiceDiaryByRange } from '../../../infrastructure/voiceDiary/voiceDiaryApiClient';

const mockedClient = agriSyncClient as unknown as { getConsent: ReturnType<typeof vi.fn> };
const mockedRange = getVoiceDiaryByRange as unknown as ReturnType<typeof vi.fn>;

const clip = (clipId: string, recordedAtUtc: string) => ({ clipId, recordedAtUtc, durationSeconds: 5, language: 'mr-IN', s3Key: `r/${clipId}` });
const TODAY_CLIP = clip('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-26T05:00:00.000Z');
// 77 days before "today": far outside the old 30-day strip
const OLD_CLIP = clip('aaaaaaaa-0000-0000-0000-000000000002', '2026-08-10T05:00:00.000Z');
// The page reads the phone, the consent and the server before drawing clips: slow on a busy machine.
const SLOW = { timeout: 20_000 };

describe('VoiceDiaryPage — the आवाज नोंदी place', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-26T06:00:00.000Z'));
        mockedClient.getConsent.mockResolvedValue({
            fullHistoryJournal: false, crossFarmAggregation: false, researchCorpusExport: false,
            version: 1, acceptedAtUtc: null, revokedAtUtc: null,
        });
        mockedRange.mockResolvedValue([TODAY_CLIP, OLD_CLIP]);
        Element.prototype.scrollIntoView = vi.fn();
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('one title bar, named like the hub row, with one big मागे that goes back', async () => {
        const onBack = vi.fn();
        render(<VoiceDiaryPage onBack={onBack} />);
        const bar = await screen.findByTestId('page-bar', {}, SLOW);
        expect(within(bar).getByTestId('page-title')).toHaveTextContent('आवाज नोंदी');
        expect(bar.textContent ?? '').not.toMatch(/Voice Diary|डायरी|सर्व नोंदी|[A-Za-z]/);
        expect(screen.getAllByTestId('page-back')).toHaveLength(1);
        fireEvent.click(within(bar).getByTestId('page-back'));
        expect(onBack).toHaveBeenCalledTimes(1);
        // the refresh action stays, in the bar
        // in plain Marathi (it was the transliteration "रिफ्रेश")
        expect(within(bar).getByTestId('voice-diary-refresh')).toHaveAttribute('aria-label', 'नव्या नोंदी पाहा');
    }, 60_000);

    it('"keep my recordings" is on this page, in Marathi only; "चालू करा" opens its turn-on confirmation', async () => {
        render(<VoiceDiaryPage onBack={() => undefined} />);
        const page = await screen.findByTestId('voice-diary-page', {}, SLOW);
        const keep = within(page).getByTestId('voice-retained-consent-toggle');
        expect(keep).toHaveTextContent('मूळ आवाज जतन करा');
        expect(keep.textContent ?? '').not.toMatch(/[A-Za-z]/);

        const cta = await screen.findByTestId('voice-diary-retention-banner-cta', {}, SLOW);
        expect(cta).toHaveTextContent('चालू करा');
        // nothing is asked before he taps
        expect(screen.queryByTestId('voice-retained-first-grant-banner')).toBeNull();
        fireEvent.click(cta);
        // "turn on" does what it says: the same confirmation the switch opens — and nothing is saved
        // until he agrees there
        const confirm = await screen.findByTestId('voice-retained-first-grant-banner');
        expect(confirm).toHaveTextContent('आवाजी नोंदी जतन करण्याची परवानगी');
        expect(confirm).toHaveTextContent('मी सहमत आहे');
        expect(confirm.textContent ?? '').not.toMatch(/[A-Za-z]/);
        expect(agriSyncClient.updateConsent).not.toHaveBeenCalled();
        // "नंतर" closes it, still without saving
        fireEvent.click(within(confirm).getByText('नंतर'));
        expect(screen.queryByTestId('voice-retained-first-grant-banner')).toBeNull();
        expect(agriSyncClient.updateConsent).not.toHaveBeenCalled();
    }, 60_000);

    it('an old recording (77 days back) is reached month by month and can be opened', async () => {
        render(<VoiceDiaryPage onBack={() => undefined} />);
        await screen.findByTestId(`voice-diary-clip-card-${TODAY_CLIP.clipId}`, {}, SLOW);
        expect(screen.getByTestId('voice-diary-calendar-month')).toHaveTextContent('ऑक्टोबर 2026');
        expect(screen.queryByTestId(`voice-diary-clip-card-${OLD_CLIP.clipId}`)).toBeNull();

        // September has nothing: he sees that plainly and is not snapped back to today
        fireEvent.click(screen.getByTestId('voice-diary-calendar-prev'));
        await waitFor(() => expect(screen.getByTestId('voice-diary-calendar-month')).toHaveTextContent('सप्टेंबर 2026'), SLOW);
        expect(screen.getByTestId('voice-diary-day-list')).toHaveTextContent('या दिवशी कोणत्याही नोंदी नाहीत');

        fireEvent.click(screen.getByTestId('voice-diary-calendar-prev'));
        await waitFor(() => expect(screen.getByTestId(`voice-diary-clip-card-${OLD_CLIP.clipId}`)).toBeInTheDocument(), SLOW);
        expect(screen.getByTestId('voice-diary-calendar-month')).toHaveTextContent('ऑगस्ट 2026');
        // the first recorded month: nothing older to page to
        expect(screen.queryByTestId('voice-diary-calendar-prev')).toBeNull();
        // the day heading and count are Marathi too
        const list = screen.getByTestId('voice-diary-day-list');
        expect(list).toHaveTextContent('1 नोंद');
        expect(list.querySelector('h2')).toHaveTextContent('ऑग');
        expect(list.querySelector('h2')?.textContent ?? '').not.toMatch(/[A-Za-z]/);
    }, 60_000);
});
