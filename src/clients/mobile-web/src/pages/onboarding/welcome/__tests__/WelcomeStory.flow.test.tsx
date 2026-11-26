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
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import WelcomeStory from '../WelcomeStory';

const OWNER_LINE = 'सुव्यवस्थित शेतीचा मालक होण्याच्या वाटेवर!';
let loadedSrcs: string[] = [];

beforeEach(() => {
    loadedSrcs = [];
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (this: HTMLMediaElement) { loadedSrcs.push(this.src); });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:welcome-note') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(['mp3'], { type: 'audio/mpeg' })) })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

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
});
