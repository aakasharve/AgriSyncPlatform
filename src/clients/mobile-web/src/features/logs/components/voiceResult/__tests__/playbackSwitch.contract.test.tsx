// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, fix round 3: M1)
//
// Founder D-2 ("OFF stops replay, never deletes the clip") and D-101 (nobody plays his recordings, he himself included): EVERY player of a
// recording that lives on this phone obeys the playback switch. This pins the BEHAVIOUR, not only the words: the shared player hook
// (`useClipPlayback`: the result screen, today's activity on आढावा, the day listen), the waveform player, the activity feed card.
// Known OFF blocks (nothing plays, no ▶, the founder's D-31 words, nothing deleted); ON plays; unknown (not asked yet / offline) does not block.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { getConsent: vi.fn(() => new Promise(() => undefined)) }, // never answers: the tests publish the state themselves
}));
vi.mock('../../../../../infrastructure/voice/clipLogLink', () => ({
    clipsForLogs: vi.fn(async () => new Map()),
    readClipAudio: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' })),
}));
vi.mock('../../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({ attachments: { where: () => ({ equals: () => ({ count: async () => 0 }) }) } }),
}));

import { peekPlaybackSwitch, publishPlaybackSwitch, resetPlaybackSwitchForTests } from '../playbackSwitch';
import { endFarmerSessionLocally, notifyFarmerSessionEnded } from '../../../../../infrastructure/storage/endFarmerSession';
import { useClipPlayback } from '../useClipPlayback';
import ClipPlayer from '../ClipPlayer';
import ActivityFeedCard from '../../ActivityFeedCard';

const CLIP = { id: 'clip-1', recordedAtUtc: '2026-10-15T06:00:00Z' } as never;

function fakeAudio() {
    const created: Array<{ play: ReturnType<typeof vi.fn> }> = [];
    const factory = vi.fn(() => {
        const el = { play: vi.fn(() => Promise.resolve()), pause: vi.fn(), duration: 4, currentTime: 0 } as unknown as HTMLAudioElement;
        created.push(el as never);
        return el;
    });
    return { factory, created };
}

beforeEach(() => {
    resetPlaybackSwitchForTests();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:x') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => cleanup());

describe('useClipPlayback - the one player behind the result screen, today\'s activity and the day listen', () => {
    it('OFF: toggle opens nothing and plays nothing', async () => {
        publishPlaybackSwitch(false);
        const { factory, created } = fakeAudio();
        const { result } = renderHook(() => useClipPlayback(factory));
        await act(async () => { await result.current.toggle('log-1', CLIP); });
        expect(factory).not.toHaveBeenCalled();
        expect(created).toHaveLength(0);
        expect(result.current.playingId).toBeNull();
    });

    it('ON: toggle plays', async () => {
        publishPlaybackSwitch(true);
        const { factory, created } = fakeAudio();
        const { result } = renderHook(() => useClipPlayback(factory));
        await act(async () => { await result.current.toggle('log-1', CLIP); });
        expect(factory).toHaveBeenCalledTimes(1);
        expect(created[0].play).toHaveBeenCalledTimes(1);
        expect(result.current.playingId).toBe('log-1');
    });

    it('unknown (not asked yet, or offline): does not block', async () => {
        const { factory, created } = fakeAudio();
        const { result } = renderHook(() => useClipPlayback(factory));
        await act(async () => { await result.current.toggle('log-1', CLIP); });
        expect(created[0].play).toHaveBeenCalledTimes(1);
    });

    it('the switch goes OFF while a clip is playing: it stops', async () => {
        publishPlaybackSwitch(true);
        const { factory, created } = fakeAudio();
        const { result } = renderHook(() => useClipPlayback(factory));
        await act(async () => { await result.current.toggle('log-1', CLIP); });
        expect(result.current.playingId).toBe('log-1');
        await act(async () => { publishPlaybackSwitch(false); });
        await waitFor(() => expect(result.current.playingId).toBeNull());
        expect((created[0] as unknown as { pause: ReturnType<typeof vi.fn> }).pause).toHaveBeenCalled();
    });

    it('OFF then ON again: the kept clip plays again', async () => {
        publishPlaybackSwitch(false);
        const { factory, created } = fakeAudio();
        const { result } = renderHook(() => useClipPlayback(factory));
        await act(async () => { await result.current.toggle('log-1', CLIP); });
        expect(created).toHaveLength(0);
        await act(async () => { publishPlaybackSwitch(true); });
        await act(async () => { await result.current.toggle('log-1', CLIP); });
        expect(created[0].play).toHaveBeenCalledTimes(1);
    });
});

describe('ClipPlayer (the waveform player on the result screen, the glance, the day and the reflect page)', () => {
    const player = () => <ClipPlayer clipKey="clip-1" durationSec={4} playing={false} progress={0} onToggle={() => undefined} testId="cp" />;

    it('OFF: no ▶, the founder\'s words instead (Marathi by default)', () => {
        publishPlaybackSwitch(false);
        render(player());
        expect(screen.queryByTestId('cp')).toBeNull();
        expect(screen.getByTestId('cp-off')).toHaveTextContent('मूळ आवाज उपलब्ध नाही.');
    });

    it('ON and unknown: the ▶ is drawn', () => {
        publishPlaybackSwitch(true);
        const view = render(player());
        expect(screen.getByTestId('cp')).toBeInTheDocument();
        view.unmount();
        resetPlaybackSwitchForTests();
        render(player());
        expect(screen.getByTestId('cp')).toBeInTheDocument();
    });
});

describe('ActivityFeedCard (today\'s activity on आढावा)', () => {
    const card = (onToggle: () => void) => (
        <ActivityFeedCard logId="l1" workDone="फवारणी" plotName="प्लॉट १" cropName="द्राक्ष" cropColor="bg-emerald-600" loggedBy="तुम्ही"
            timeLabel="9:00" statusTone="pending" audio={{ durationLabel: '0:04', playing: false, onToggle }} onClick={() => undefined} />
    );

    it('OFF: no ▶ on the card, the founder\'s words instead, and pressing nothing plays', () => {
        publishPlaybackSwitch(false);
        const onToggle = vi.fn();
        render(card(onToggle));
        expect(screen.queryByTestId('card-play')).toBeNull();
        expect(screen.getByTestId('card-play-off')).toHaveTextContent('मूळ आवाज उपलब्ध नाही.');
        expect(onToggle).not.toHaveBeenCalled();
    });

    it('ON: the ▶ plays', () => {
        publishPlaybackSwitch(true);
        const onToggle = vi.fn();
        render(card(onToggle));
        fireEvent.click(screen.getByTestId('card-play'));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });
});

describe('fix round 4 (L2): the phone forgets the switch when the person changes', () => {
    it('sign-out (endFarmerSessionLocally) forgets a known state, so the next person starts unknown', () => {
        publishPlaybackSwitch(false);
        expect(peekPlaybackSwitch()).toBe(false);
        endFarmerSessionLocally();
        expect(peekPlaybackSwitch()).toBeUndefined();
    });

    it('an account switch (notifyFarmerSessionEnded) forgets it too', async () => {
        publishPlaybackSwitch(true);
        notifyFarmerSessionEnded();
        expect(peekPlaybackSwitch()).toBeUndefined();
    });
});
