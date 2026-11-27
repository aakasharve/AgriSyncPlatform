// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The founder's welcome voice note as a first-run step (between the phone permissions and the role
 * welcome). Pins what the founder asked for and what broke on the phone:
 *  - it starts by itself after the short intro (no play button);
 *  - the owner line shows only for an owner seat; no "लॉगिन यशस्वी" (not true at this step);
 *  - the skip asks once, honestly, and promises no "listen later" place (doctrine P5);
 *  - the note is played from MEMORY. Streaming it from Capacitor's on-device server cut it off after
 *    a few seconds on the founder's phone (that server answers "from byte N" with byte 0).
 *  - repair R3 lane S1 (V6b-A, founder 27 Nov 2026): only the part name and a small "वगळा" at the top; at the
 *    bottom one drag bar with the part ticks, the time played and the time left, a bubble with the part name
 *    while dragging, and ONE big play / pause button. No 10-second buttons (the founder's change).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const lang = vi.hoisted(() => ({ value: undefined as 'mr' | 'en' | undefined }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => (lang.value ? { language: lang.value, setLanguage: () => undefined, t: (k: string) => k } : undefined),
}));

import WelcomeStory from '../WelcomeStory';
import { CHAPTER_STARTS, STORY_DURATION } from '../welcomeTimeline';

const OWNER_LINE = 'सुव्यवस्थित शेतीचा मालक होण्याच्या वाटेवर!';
let loadedSrcs: string[] = [];
let players: HTMLMediaElement[] = [];

beforeEach(() => {
    loadedSrcs = [];
    players = [];
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (this: HTMLMediaElement) { loadedSrcs.push(this.src); players.push(this); });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:welcome-note') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(['mp3'], { type: 'audio/mpeg' })) })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); lang.value = undefined; });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('WelcomeStory — the welcome voice note step', () => {
    it('owner seat: "अभिनंदन!" and the owner line; never "लॉगिन यशस्वी"', async () => {
        render(<WelcomeStory onDone={vi.fn()} showOwnerLine />);
        await flush();
        expect(screen.getByText('अभिनंदन!')).toBeInTheDocument();
        expect(screen.getByText(OWNER_LINE)).toBeInTheDocument();
        expect(screen.queryByText(/लॉगिन यशस्वी/)).toBeNull();
    });

    it('worker / mukadam: the voice note without the owner line', async () => {
        render(<WelcomeStory onDone={vi.fn()} showOwnerLine={false} />);
        await flush();
        expect(screen.getByTestId('welcome-intro')).toBeInTheDocument();
        expect(screen.queryByText(OWNER_LINE)).toBeNull();
    });

    it('plays the note from memory (a blob), not streamed from the app server', async () => {
        render(<WelcomeStory onDone={vi.fn()} />);
        await flush();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(loadedSrcs).toEqual(['blob:welcome-note']);
    });

    it('if the file cannot be read into memory, it still plays (streamed) rather than staying silent', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
        render(<WelcomeStory onDone={vi.fn()} />);
        await flush();
        expect(loadedSrcs).toHaveLength(1);
        expect(loadedSrcs[0]).toMatch(/welcome-note/);
    });

    it('starts by itself after the intro — no play button tapped', async () => {
        vi.useFakeTimers();
        const play = vi.mocked(HTMLMediaElement.prototype.play);
        render(<WelcomeStory onDone={vi.fn()} />);
        expect(play).not.toHaveBeenCalled();
        await act(async () => { vi.advanceTimersByTime(9500); });
        expect(play).toHaveBeenCalled();
    });

    it('skip during the countdown asks once, honestly, then moves on', async () => {
        const onDone = vi.fn();
        render(<WelcomeStory onDone={onDone} />);
        await flush();
        fireEvent.click(screen.getByTestId('welcome-story-skip'));
        expect(screen.getByText('एक छोटी विनंती')).toBeInTheDocument();
        expect(screen.getByText('फक्त 2 मिनिटं लागतील')).toBeInTheDocument();
        expect(screen.queryByText(/नंतर ऐक/)).toBeNull();
        fireEvent.click(screen.getByTestId('welcome-skip-confirm'));
        expect(onDone).toHaveBeenCalledWith(false);
    });

    it('choosing to listen from the sheet starts the voice', async () => {
        const play = vi.mocked(HTMLMediaElement.prototype.play);
        render(<WelcomeStory onDone={vi.fn()} />);
        await flush();
        fireEvent.click(screen.getByTestId('welcome-story-skip'));
        fireEvent.click(screen.getByTestId('welcome-skip-stay'));
        expect(play).toHaveBeenCalled();
    });

    // R1 04-A (root cause proven in the walk, 26 Nov): the router handed a NEW "finished" callback on
    // every redraw (background sync redraws every 15 s); the player's set-up re-ran on it and its
    // clean-up paused the voice. The note stopped somewhere between 0 and 15 s on every phone.
    it('a redraw with a NEW callback mid-play neither pauses nor re-creates the player; the end calls the latest one', async () => {
        vi.useFakeTimers();
        const pause = vi.mocked(HTMLMediaElement.prototype.pause);
        const first = vi.fn();
        const latest = vi.fn();
        const { rerender } = render(<WelcomeStory onDone={first} />);
        await flush();
        fireEvent.click(screen.getByTestId('welcome-story-skip'));
        fireEvent.click(screen.getByTestId('welcome-skip-stay'));
        expect(players).toHaveLength(1);
        const pausesBefore = pause.mock.calls.length;

        rerender(<WelcomeStory onDone={vi.fn()} />);
        rerender(<WelcomeStory onDone={latest} />);
        await flush();

        expect(pause.mock.calls.length).toBe(pausesBefore);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(players).toHaveLength(1);
        expect(players[0].getAttribute('src')).toBe('blob:welcome-note');

        act(() => { players[0].dispatchEvent(new Event('ended')); });
        await act(async () => { vi.advanceTimersByTime(1000); });
        expect(latest).toHaveBeenCalledWith(true);
        expect(first).not.toHaveBeenCalled();
    });

    it('the play button always shows what the voice is really doing', async () => {
        render(<WelcomeStory onDone={vi.fn()} />);
        await flush();
        const audio = players[0];
        let paused = false;
        Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });
        act(() => { audio.dispatchEvent(new Event('play')); });
        expect(screen.getByRole('button', { name: 'थांबवा' })).toBeInTheDocument();
        // The voice stops without a "pause" event (as when the old player was swapped out): the button follows.
        paused = true;
        await waitFor(() => expect(screen.getByRole('button', { name: 'ऐका' })).toBeInTheDocument());
    });
});

describe('WelcomeStory — the V6b-A player', () => {
    /** The drag bar, laid out 200 px wide from the left edge (jsdom does no layout). */
    const theBar = () => {
        const bar = screen.getByRole('slider', { name: 'संदेशात पुढे-मागे जा' });
        bar.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 30, height: 30, x: 0, y: 0, toJSON: () => ({}) });
        return bar;
    };

    it('top: only the part name and a small "वगळा"; the seven small part bars are gone', async () => {
        render(<WelcomeStory onDone={vi.fn()} />);
        await flush();
        expect(screen.getByTestId('welcome-part-name')).toHaveTextContent('स्वागत');
        expect(screen.queryByRole('group', { name: 'संदेशाचे भाग' })).toBeNull();
        expect(screen.queryAllByRole('button', { name: /पासून ऐका/ })).toHaveLength(0);
        const css = readFileSync(join(__dirname, '..', 'welcomeStory.css'), 'utf8');
        const skip = css.match(/\.ws-skip\s*\{[^}]*\}/)?.[0] ?? '';
        expect(skip).toContain('font-size: 13px');
    });

    it('bottom: one big play / pause button, and no 10-second back or forward buttons', async () => {
        render(<WelcomeStory onDone={vi.fn()} />);
        await flush();
        const player = screen.getByTestId('welcome-player');
        expect(within(player).getAllByRole('button')).toHaveLength(1);
        expect(within(player).getByRole('button', { name: 'ऐका' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /10 सेकंद/ })).toBeNull();
        expect(within(player).queryByText('10')).toBeNull();
    });

    it('the drag bar has a tick at each part start after the first (six), then the time played and the time left', async () => {
        render(<WelcomeStory onDone={vi.fn()} />);
        await flush();
        const bar = theBar();
        const ticks = within(bar).getAllByTestId('welcome-track-tick');
        expect(ticks).toHaveLength(6);
        ticks.forEach((tick, i) => {
            expect(parseFloat(tick.style.left)).toBeCloseTo((CHAPTER_STARTS[i + 1]! / STORY_DURATION) * 100, 3);
        });
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', String(Math.floor(STORY_DURATION)));
        expect(screen.getByTestId('welcome-time-now')).toHaveTextContent('0:00');
        expect(screen.getByTestId('welcome-time-left')).toHaveTextContent('−2:18');
        // the times sit under the bar
        expect(bar.compareDocumentPosition(screen.getByTestId('welcome-time-now')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByTestId('welcome-track-bubble')).toBeNull();
    });

    it('dragging: a bubble names the part, the voice moves there and the times follow; it plays on after if it was playing', async () => {
        const pause = vi.mocked(HTMLMediaElement.prototype.pause);
        const play = vi.mocked(HTMLMediaElement.prototype.play);
        render(<WelcomeStory onDone={vi.fn()} />);
        await flush();
        const audio = players[0]!;
        Object.defineProperty(audio, 'paused', { configurable: true, get: () => false });
        const bar = theBar();
        const pausesBefore = pause.mock.calls.length;
        const playsBefore = play.mock.calls.length;

        fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
        expect(pause.mock.calls.length).toBe(pausesBefore + 1);
        expect(audio.currentTime).toBeCloseTo(STORY_DURATION / 2, 2);
        expect(screen.getByTestId('welcome-track-bubble')).toHaveTextContent('कामाची खात्री');
        expect(screen.getByTestId('welcome-time-now')).toHaveTextContent('1:09');
        expect(screen.getByTestId('welcome-time-left')).toHaveTextContent('−1:09');

        fireEvent.pointerMove(bar, { clientX: 20, pointerId: 1 });
        expect(audio.currentTime).toBeCloseTo(STORY_DURATION / 10, 2);
        expect(screen.getByTestId('welcome-track-bubble')).toHaveTextContent('एक विचार करा');
        expect(screen.getByTestId('welcome-time-now')).toHaveTextContent('0:13');

        fireEvent.pointerUp(bar, { clientX: 20, pointerId: 1 });
        expect(screen.queryByTestId('welcome-track-bubble')).toBeNull();
        expect(play.mock.calls.length).toBe(playsBefore + 1);
    });

    it('a drag while paused stays paused after', async () => {
        const play = vi.mocked(HTMLMediaElement.prototype.play);
        render(<WelcomeStory onDone={vi.fn()} />);
        await flush();
        const audio = players[0]!;
        Object.defineProperty(audio, 'paused', { configurable: true, get: () => true });
        const bar = theBar();
        const playsBefore = play.mock.calls.length;
        fireEvent.pointerDown(bar, { clientX: 180, pointerId: 1 });
        fireEvent.pointerUp(bar, { clientX: 180, pointerId: 1 });
        expect(audio.currentTime).toBeCloseTo(STORY_DURATION * 0.9, 2);
        expect(play.mock.calls.length).toBe(playsBefore);
    });

    it('a drag past the ends stops at the start and the end of the note', async () => {
        render(<WelcomeStory onDone={vi.fn()} />);
        await flush();
        const audio = players[0]!;
        Object.defineProperty(audio, 'paused', { configurable: true, get: () => true });
        const bar = theBar();
        fireEvent.pointerDown(bar, { clientX: -50, pointerId: 1 });
        expect(audio.currentTime).toBe(0);
        fireEvent.pointerMove(bar, { clientX: 400, pointerId: 1 });
        expect(screen.getByTestId('welcome-track-bubble')).toHaveTextContent('चला, सुरुवात करूया');
        fireEvent.pointerUp(bar, { clientX: 400, pointerId: 1 });
        expect(audio.currentTime).toBeLessThanOrEqual(STORY_DURATION);
        expect(audio.currentTime).toBeGreaterThan(STORY_DURATION - 0.5);
    });

    it('the drag bar\'s spoken name has its English twin in English mode', async () => {
        lang.value = 'en';
        render(<WelcomeStory onDone={vi.fn()} />);
        await flush();
        expect(screen.getByRole('slider', { name: 'Move through the message' })).toBeInTheDocument();
    });
});
