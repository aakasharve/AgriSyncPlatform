// @vitest-environment jsdom
// spec: dfes-companion-2026-07-11 (farm-memory) — ADR-DS-017 (c)
//
// The server-side half of "stop saving future voice must not delete
// history" is worth nothing on its own. VoiceDiaryPage used to gate the
// retained-tier fetch on the consent flag and set cloudClips to [] when
// it was false, so the moment the farmer switched the toggle off his
// entire saved history disappeared from the screen — instantly, before
// any sweep, and now permanently, because the sweep no longer removes it.
// From where he is sitting that is indistinguishable from deletion.
//
// So this file asserts the read path directly: consent OFF, retained
// clips present, and the page must still ask for them and still show
// them.
//
// The mocks stop at the page's own boundaries — Dexie, the retained-tier
// API client, and the two crypto modules ClipPlayerCard imports (which
// touch WebCrypto and IndexedDB at module scope and have nothing to do
// with the question being asked). The consent flag itself is NOT mocked:
// it comes through the real useFullHistoryJournalConsent hook reading a
// stubbed getConsent, because "what does the page do when consent is
// off" is exactly the behaviour under test and stubbing the hook would
// hollow it out.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: {
        getConsent: vi.fn(),
        updateConsent: vi.fn(),
    },
}));

vi.mock('../../../infrastructure/voiceDiary/voiceDiaryApiClient', () => ({
    getVoiceDiaryByRange: vi.fn(),
    getVoiceDiaryById: vi.fn(),
}));

vi.mock('../../../infrastructure/voice/VoiceClipRetention', () => ({
    purgeExpiredProcessingVoiceClips: vi.fn().mockResolvedValue(undefined),
    readVoiceClipPlaintext: vi.fn(),
}));

vi.mock('../../../infrastructure/security/voiceEnvelope', () => ({
    openVoiceClip: vi.fn(),
}));

vi.mock('../../../infrastructure/security/tenantDekClient', () => ({
    resolveDek: vi.fn(),
}));

// Dexie holds only the 30-day processing cache. Empty here on purpose:
// if anything renders, it came from the retained tier.
vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        voiceClips: {
            where: () => ({ above: () => ({ toArray: async () => [] }) }),
        },
    }),
}));

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import VoiceDiaryPage from '../pages/VoiceDiaryPage';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { getVoiceDiaryByRange } from '../../../infrastructure/voiceDiary/voiceDiaryApiClient';

const mockedClient = agriSyncClient as unknown as { getConsent: ReturnType<typeof vi.fn> };
const mockedRange = getVoiceDiaryByRange as unknown as ReturnType<typeof vi.fn>;

/** Two days ago, so it lands inside the page's 60-day calendar window. */
const RECORDED_AT = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

const retainedClip = {
    clipId: '11111111-1111-1111-1111-111111111111',
    recordedAtUtc: RECORDED_AT,
    durationSeconds: 7,
    language: 'mr-IN',
    s3Key: 'retained/u/1.bin',
};

describe('VoiceDiaryPage — saved history after the farmer stops future saving', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Consent OFF, and previously withdrawn: the exact state in which
        // the page used to blank the list.
        mockedClient.getConsent.mockResolvedValue({
            fullHistoryJournal: false,
            crossFarmAggregation: false,
            researchCorpusExport: false,
            version: 1,
            acceptedAtUtc: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
            revokedAtUtc: new Date().toISOString(),
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('still asks the retained tier for history even though future saving is off', async () => {
        mockedRange.mockResolvedValue([retainedClip]);

        render(<VoiceDiaryPage onBack={() => undefined} onOpenSettings={() => undefined} forceLocale="en-IN" />);

        await waitFor(() => {
            expect(mockedRange).toHaveBeenCalledTimes(1);
        });
    });

    it('renders the retained clip rather than the empty state', async () => {
        mockedRange.mockResolvedValue([retainedClip]);

        render(<VoiceDiaryPage onBack={() => undefined} onOpenSettings={() => undefined} forceLocale="en-IN" />);

        // Present: the clip he recorded before turning the toggle off.
        await waitFor(() => {
            expect(screen.getByTestId(`voice-diary-clip-card-${retainedClip.clipId}`)).toBeInTheDocument();
        });

        // And the "no voice notes yet" prompt must not be what he sees —
        // telling a farmer with history that he has none is the same lie
        // the blanked list told.
        expect(screen.queryByTestId('voice-diary-empty-state')).toBeNull();
    });

    it('shows the empty state only when there genuinely is no history', async () => {
        // The control. Without this, the assertion above would also pass
        // against a page that had simply stopped rendering the empty
        // state at all.
        mockedRange.mockResolvedValue([]);

        render(<VoiceDiaryPage onBack={() => undefined} onOpenSettings={() => undefined} forceLocale="en-IN" />);

        await waitFor(() => {
            expect(screen.getByTestId('voice-diary-empty-state')).toBeInTheDocument();
        });
    });
});
