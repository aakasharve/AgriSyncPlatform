// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves (voice archive recovery, defect D5)
//
// A recording that exists only on the server (fresh install, new phone) is fetched and
// decrypted on the FIRST tap of play. The real-browser recovery test found that the first
// tap did nothing: the handler called audio.play() before React had written the freshly
// fetched blob URL into the <audio> element, so there was nothing to play; only a second
// tap worked. This pins that the audio element has its source when play() is called.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../infrastructure/voice/retainedClipReader', () => ({
    openRetainedClip: vi.fn(),
}));
vi.mock('../../../infrastructure/voice/VoiceClipRetention', () => ({
    readVoiceClipPlaintext: vi.fn(),
}));

import { openRetainedClip } from '../../../infrastructure/voice/retainedClipReader';
import ClipPlayerCard from '../components/ClipPlayerCard';

describe('ClipPlayerCard - first tap on a server-only recording', () => {
    let playedWithSrc: Array<string | null>;

    beforeEach(() => {
        playedWithSrc = [];
        vi.mocked(openRetainedClip).mockReset();
        vi.mocked(openRetainedClip).mockResolvedValue({
            ok: true,
            bytes: new Uint8Array([1, 2, 3, 4]),
            mimeType: 'audio/webm',
        } as never);
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            writable: true,
            value: vi.fn(() => 'blob:recovered-clip'),
        });
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
            playedWithSrc.push(this.getAttribute('src'));
            return Promise.resolve();
        });
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('has the recovered audio loaded when play() is called on the very first tap', async () => {
        render(
            <ClipPlayerCard
                locale="mr-IN"
                clip={{ id: '651c5b30-eb70-5078-91ed-9530793a0373', recordedAtUtc: '2026-10-15T06:00:00Z', source: 'cloud' }}
            />,
        );

        fireEvent.click(screen.getByLabelText('Play'));

        await waitFor(() => expect(playedWithSrc.length).toBe(1));
        expect(openRetainedClip).toHaveBeenCalledTimes(1);
        // The bug: play() ran while the element had no source (null/empty).
        expect(playedWithSrc[0]).toBe('blob:recovered-clip');
    });

    it('does not call play() when the recording could not be opened', async () => {
        vi.mocked(openRetainedClip).mockResolvedValueOnce({ ok: false, error: 'dek_unavailable' } as never);
        render(
            <ClipPlayerCard
                locale="mr-IN"
                clip={{ id: '651c5b30-eb70-5078-91ed-9530793a0373', recordedAtUtc: '2026-10-15T06:00:00Z', source: 'cloud' }}
            />,
        );

        fireEvent.click(screen.getByLabelText('Play'));

        await waitFor(() => expect(openRetainedClip).toHaveBeenCalledTimes(1));
        expect(playedWithSrc.length).toBe(0);
    });
});
