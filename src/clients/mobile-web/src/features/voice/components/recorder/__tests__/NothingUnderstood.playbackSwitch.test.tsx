// @vitest-environment jsdom
/**
 * CTO fix (25-26 Nov full check): the "nothing understood" screen plays HIS own clip. Its SavedClip already hides the play button and shows
 * the founder's D-31 words while the shared playback switch is OFF; the screen owns the audio element, so it must also STOP a clip that is
 * playing when the switch turns OFF (the consent screen promises his recordings "can no longer be played back"). The sound guard
 * (i18n/__tests__/noReviewMarkers.test.ts) lists it as GATED.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../infrastructure/voice/clipLogLink', () => ({
    latestUnlinkedClipSince: vi.fn(async () => ({ id: 'clip-1', durationMs: 4000 })),
    readClipAudio: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' })),
}));
vi.mock('../../../noWorkAnswer', () => ({ useNoWorkQuestion: () => null }));

import { NothingUnderstood } from '../NothingUnderstood';
import { publishPlaybackSwitch, resetPlaybackSwitchForTests } from '../../../../logs/components/voiceResult/playbackSwitch';

class FakeAudio {
    static all: FakeAudio[] = [];
    paused = true;
    onended: (() => void) | null = null;
    constructor(public src = '') { FakeAudio.all.push(this); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
}

beforeEach(() => {
    resetPlaybackSwitchForTests();
    FakeAudio.all = [];
    vi.stubGlobal('Audio', FakeAudio);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:clip') });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetPlaybackSwitchForTests(); });

describe('the nothing-understood screen and his playback switch', () => {
    it('with the switch OFF: no play button, the D-31 words stand in its place', async () => {
        act(() => { publishPlaybackSwitch(false); });
        render(<NothingUnderstood transcript="आज काहीच नाही" />);
        expect(await screen.findByTestId('nu-play-off')).toBeInTheDocument();
        expect(screen.queryByTestId('nu-play')).toBeNull();
    });

    it('with the switch ON: his clip has its play button', async () => {
        act(() => { publishPlaybackSwitch(true); });
        render(<NothingUnderstood transcript="आज काहीच नाही" />);
        expect(await screen.findByTestId('nu-play')).toBeInTheDocument();
    });

    it('a clip that is playing STOPS when the switch turns OFF', async () => {
        act(() => { publishPlaybackSwitch(true); });
        render(<NothingUnderstood transcript="आज काहीच नाही" />);
        const play = await screen.findByTestId('nu-play');
        fireEvent.click(play.querySelector('button') ?? play);
        await waitFor(() => expect(FakeAudio.all).toHaveLength(1));
        await waitFor(() => expect(FakeAudio.all[0].paused).toBe(false));
        act(() => { publishPlaybackSwitch(false); });
        await waitFor(() => expect(FakeAudio.all[0].paused).toBe(true));
    });
});
