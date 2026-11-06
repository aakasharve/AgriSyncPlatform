// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, fix round 2: N2) - founder D-2: OFF stops replay, never deletes.
//
// While the playback switch is OFF the server refuses to play a kept recording (403 ShramSafal.OriginalVoiceNotKept). The card then shows
// the founder's D-31 words "Original recording unavailable" - not the generic "could not play" - and nothing is deleted.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../infrastructure/voice/retainedClipReader', () => ({ openRetainedClip: vi.fn() }));
vi.mock('../../../infrastructure/voice/VoiceClipRetention', () => ({ readVoiceClipPlaintext: vi.fn() }));

import { openRetainedClip } from '../../../infrastructure/voice/retainedClipReader';
import { ORIGINAL_VOICE_NOT_KEPT_ERROR } from '../../../infrastructure/voiceDiary/originalVoiceNotKept';
import ClipPlayerCard from '../components/ClipPlayerCard';

const CLIP = { id: '651c5b30-eb70-5078-91ed-9530793a0373', recordedAtUtc: '2026-10-15T06:00:00Z', source: 'cloud' as const };

describe('ClipPlayerCard - the playback switch is OFF', () => {
    beforeEach(() => {
        vi.mocked(openRetainedClip).mockReset();
        vi.mocked(openRetainedClip).mockRejectedValue(new Error(ORIGINAL_VOICE_NOT_KEPT_ERROR));
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:x') });
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('Marathi: shows "मूळ आवाज उपलब्ध नाही." (the founder\'s D-31 words), not the generic failure', async () => {
        render(<ClipPlayerCard locale="mr-IN" clip={CLIP} />);
        fireEvent.click(screen.getByLabelText('ऐका'));
        const message = await screen.findByTestId(`voice-diary-clip-play-error-${CLIP.id}`);
        await waitFor(() => expect(message).toHaveTextContent('मूळ आवाज उपलब्ध नाही.'));
        expect(message).not.toHaveTextContent('ऐकता आले नाही.');
    });

    it('English: shows "Original recording unavailable."', async () => {
        render(<ClipPlayerCard locale="en-IN" clip={CLIP} />);
        fireEvent.click(screen.getByLabelText('Play'));
        const message = await screen.findByTestId(`voice-diary-clip-play-error-${CLIP.id}`);
        expect(message).toHaveTextContent('Original recording unavailable.');
    });

    it('any other failure still reads the generic "could not play"', async () => {
        vi.mocked(openRetainedClip).mockRejectedValue(new Error('network'));
        render(<ClipPlayerCard locale="en-IN" clip={CLIP} />);
        fireEvent.click(screen.getByLabelText('Play'));
        const message = await screen.findByTestId(`voice-diary-clip-play-error-${CLIP.id}`);
        expect(message).toHaveTextContent('Could not play.');
    });
});
