// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves (voice archive path, defect D2)
//
// The phone keys a recording by its 64-hex local id; the server lists the SAME
// recording under the archive Guid derived from it. The diary must show ONE card
// (keyed by the local id, so playback prefers the local copy), not a local card and
// a phantom cloud twin.

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

vi.mock('../../../infrastructure/sync/VoiceArchiveUploader', () => ({
    voiceArchiveUploader: { triggerNow: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../infrastructure/voice/retainedClipReader', () => ({
    openRetainedClip: vi.fn(),
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
            toArray: async () => [{
                id: 'a3f5c9d17b2e48a0916c5d3e2f1a0b7c8d9e4f5a6b7c8d9e0f1a2b3c4d5e6f70',
                farmId: 'f1',
                recordedAtUtc: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
                durationMs: 7000,
                mimeType: 'audio/webm',
                status: 'parsed',
            }],
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
import { toArchiveClipId } from '../../../infrastructure/voice/archiveClipId';

const LOCAL_ID = 'a3f5c9d17b2e48a0916c5d3e2f1a0b7c8d9e4f5a6b7c8d9e0f1a2b3c4d5e6f70';
const OTHER_CLOUD_ONLY = 'c1111111-1111-4111-8111-111111111111';
const RECORDED_AT = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

describe('VoiceDiaryPage - local clip and its archived copy are one card', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        (agriSyncClient as unknown as { getConsent: ReturnType<typeof vi.fn> }).getConsent.mockResolvedValue({
            fullHistoryJournal: true,
            crossFarmAggregation: false,
            researchCorpusExport: false,
            version: 1,
            acceptedAtUtc: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
            revokedAtUtc: null,
        });
    });

    afterEach(() => cleanup());

    it('merges the server archive Guid onto the local hex-id card and keeps a cloud-only clip under its own Guid', async () => {
        (getVoiceDiaryByRange as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
            { clipId: toArchiveClipId(LOCAL_ID), recordedAtUtc: RECORDED_AT, durationSeconds: 7, language: 'mr-IN', s3Key: 'retained/u/a.bin' },
            { clipId: OTHER_CLOUD_ONLY, recordedAtUtc: RECORDED_AT, durationSeconds: 5, language: 'mr-IN', s3Key: 'retained/u/b.bin' },
        ]);

        render(<VoiceDiaryPage onBack={() => undefined} onOpenSettings={() => undefined} forceLocale="en-IN" />);

        await waitFor(() => {
            expect(screen.getByTestId(`voice-diary-clip-card-${LOCAL_ID}`)).toBeInTheDocument();
        });
        expect(screen.getByTestId(`voice-diary-clip-card-${OTHER_CLOUD_ONLY}`)).toBeInTheDocument();
        expect(screen.queryByTestId(`voice-diary-clip-card-${toArchiveClipId(LOCAL_ID)}`)).toBeNull();
        expect(screen.getAllByTestId(/^voice-diary-clip-card-/)).toHaveLength(2);
    });
});
