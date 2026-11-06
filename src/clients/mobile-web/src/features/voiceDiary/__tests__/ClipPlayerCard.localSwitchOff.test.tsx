// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, fix round 2 add-on: N2 on the phone)
//
// Founder D-2: OFF stops replay and never deletes the clip. The playback switch also governs the copy this PHONE holds: while it is OFF
// a clip recorded on this phone does not play from its own copy either; the card shows the founder's D-31 words "मूळ आवाज उपलब्ध नाही."
// / "Original recording unavailable."; the clip stays; turning the switch ON again plays it. The state the card is given is the one the
// phone holds (`fullHistoryJournal` from the consent read): ON in any words version counts for his own clips. When the phone does not
// know the state (undefined) nothing is blocked: unknown is not OFF.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../infrastructure/voice/retainedClipReader', () => ({ openRetainedClip: vi.fn() }));
vi.mock('../../../infrastructure/voice/VoiceClipRetention', () => ({
    readVoiceClipPlaintext: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
}));

import { readVoiceClipPlaintext } from '../../../infrastructure/voice/VoiceClipRetention';
import ClipPlayerCard from '../components/ClipPlayerCard';

const LOCAL = {
    id: 'local-clip-1',
    recordedAtUtc: '2026-10-15T06:00:00Z',
    source: 'local' as const,
    localRecord: { id: 'local-clip-1', mimeType: 'audio/webm' } as never,
};

let play: ReturnType<typeof vi.fn>;

describe('ClipPlayerCard - a clip recorded on this phone, and the playback switch', () => {
    beforeEach(() => {
        play = vi.fn(() => Promise.resolve());
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play as never);
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:local') });
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('OFF: the on-device copy does not play, the founder\'s words are shown (Marathi), and the clip is kept', async () => {
        render(<ClipPlayerCard locale="mr-IN" clip={LOCAL} playbackAllowed={false} />);
        await new Promise(r => setTimeout(r, 30)); // let the local copy be opened, if it is going to be
        fireEvent.click(screen.getByLabelText('ऐका'));
        const message = await screen.findByTestId('voice-diary-clip-play-error-local-clip-1');
        expect(message).toHaveTextContent('मूळ आवाज उपलब्ध नाही.');
        expect(play).not.toHaveBeenCalled();
        expect(document.querySelector('audio')?.getAttribute('src') ?? '').toBe('');
        expect(screen.getByTestId('voice-diary-clip-play-local-clip-1')).toBeInTheDocument(); // the card (the clip) is still listed
    });

    it('OFF, English: "Original recording unavailable."', async () => {
        render(<ClipPlayerCard locale="en-IN" clip={LOCAL} playbackAllowed={false} />);
        const message = await screen.findByTestId('voice-diary-clip-play-error-local-clip-1');
        expect(message).toHaveTextContent('Original recording unavailable.');
        fireEvent.click(screen.getByLabelText('Play'));
        expect(play).not.toHaveBeenCalled();
    });

    it('ON: the on-device copy plays', async () => {
        render(<ClipPlayerCard locale="mr-IN" clip={LOCAL} playbackAllowed={true} />);
        await waitFor(() => expect(readVoiceClipPlaintext).toHaveBeenCalled());
        await waitFor(() => expect(document.querySelector('audio')?.getAttribute('src')).toBe('blob:local'));
        fireEvent.click(screen.getByLabelText('ऐका'));
        await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
        expect(screen.queryByTestId('voice-diary-clip-play-error-local-clip-1')).toBeNull();
    });

    it('unknown state (undefined) blocks nothing: unknown is not OFF', async () => {
        render(<ClipPlayerCard locale="mr-IN" clip={LOCAL} />);
        await waitFor(() => expect(document.querySelector('audio')?.getAttribute('src')).toBe('blob:local'));
        fireEvent.click(screen.getByLabelText('ऐका'));
        await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    });

    it('OFF then ON again: the kept clip plays again', async () => {
        const view = render(<ClipPlayerCard locale="mr-IN" clip={LOCAL} playbackAllowed={false} />);
        await screen.findByTestId('voice-diary-clip-play-error-local-clip-1');
        view.rerender(<ClipPlayerCard locale="mr-IN" clip={LOCAL} playbackAllowed={true} />);
        await waitFor(() => expect(document.querySelector('audio')?.getAttribute('src')).toBe('blob:local'));
        expect(screen.queryByTestId('voice-diary-clip-play-error-local-clip-1')).toBeNull();
        fireEvent.click(screen.getByLabelText('ऐका'));
        await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    });
});
