// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A4; founder 28 Nov) — the log tab's screen after stop:
 *   - "जतन झालं ✓" pops when his recording is really kept (the save path's 'kept' event), with ONE success buzz and ONE soft sound;
 *   - then Sathi's ring with "श्रम साथी समजून घेत आहे" and the quiet chase, for as long as the real answer is pending (no timer ends
 *     it: it leaves only when the app's status changes); it never lights a part by itself.
 */
import '@testing-library/jest-dom/vitest';
import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sound = vi.hoisted(() => ({ play: vi.fn(() => true) }));
vi.mock('../../../../../shared/utils/softChime', () => ({ playSoftChime: sound.play }));
vi.mock('../../../../../i18n/LanguageContext', () => {
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k });
    return { useOptionalLanguage: ctx, useLanguage: ctx };
});

import { noteVoiceJourney, resetVoiceJourneyForTests } from '../../../../../infrastructure/voice/voiceJourneySignal';
import { hapticFeedback } from '../../../../../shared/utils/haptics';
import type { AgriLogResponse } from '../../../../../domain/types/log.types';
import { RingWaitScreen, SAVED_POP_MS } from '../RingWaitScreen';

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const litNodes = () => screen.getByTestId('sathi-ring').querySelectorAll('[data-state="told"],[data-state="missed"]');

let success: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    // Timers and the clock are faked; the ring's animation frames stay real (fast-forwarding minutes of frames is only slow, not a test).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-28T10:00:00.000Z'));
    resetVoiceJourneyForTests();
    sound.play.mockClear();
    success = vi.spyOn(hapticFeedback, 'success');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetVoiceJourneyForTests(); });

describe('A4 — the screen after stop', () => {
    it('Sathi\'s ring with "श्रम साथी समजून घेत आहे" and the quiet chase; nothing lit', () => {
        render(<RingWaitScreen />);
        expect(screen.getByTestId('ring-wait-line')).toHaveTextContent('श्रम साथी समजून घेत आहे');
        expect(screen.getByTestId('sathi-ring')).toHaveAttribute('data-mode', 'chase');
        expect(litNodes()).toHaveLength(0);
        expect(screen.getByTestId('sathi-ring').textContent?.trim()).toBe('');
        expect(document.body.textContent).not.toMatch(/\bAI\b/);
    });

    it('"जतन झालं ✓" pops when the recording is really kept: ONE success buzz, ONE soft sound; then it steps aside, the ring stays', () => {
        render(<RingWaitScreen />);
        expect(screen.queryByTestId('saved-pop')).not.toBeInTheDocument();
        expect(success).not.toHaveBeenCalled();
        act(() => { noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: 12_000 }); });
        expect(screen.getByTestId('saved-pop-title')).toHaveTextContent('जतन झालं ✓');
        expect(success).toHaveBeenCalledTimes(1);
        expect(sound.play).toHaveBeenCalledTimes(1);
        // the pop says only what is true now: no "आजचं काम जतन झालं" (the work is not understood yet)
        expect(screen.getByTestId('saved-pop')).not.toHaveTextContent('आजचं काम');
        advance(SAVED_POP_MS + 10);
        expect(screen.queryByTestId('saved-pop')).not.toBeInTheDocument();
        expect(screen.getByTestId('ring-wait')).toBeInTheDocument();
        // later real events never buzz or pop again, and never light a part here
        act(() => { noteVoiceJourney({ kind: 'understood', draft: { summary: 'x' } as unknown as AgriLogResponse }); });
        act(() => { noteVoiceJourney({ kind: 'written', logIds: ['L-1'] }); });
        expect(success).toHaveBeenCalledTimes(1);
        expect(sound.play).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('saved-pop')).not.toBeInTheDocument();
        expect(litNodes()).toHaveLength(0);
    });

    it('a tap closes the pop at once', () => {
        render(<RingWaitScreen />);
        act(() => { noteVoiceJourney({ kind: 'kept', input: 'text' }); });
        fireEvent.click(screen.getByTestId('saved-pop'));
        expect(screen.queryByTestId('saved-pop')).not.toBeInTheDocument();
        expect(screen.getByTestId('sathi-ring')).toHaveAttribute('data-mode', 'chase');
    });

    it('nothing kept yet (offline, or a failure before the save): no pop, no buzz, no sound', () => {
        vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
        render(<RingWaitScreen />);
        advance(60_000);
        expect(screen.queryByTestId('saved-pop')).not.toBeInTheDocument();
        expect(success).not.toHaveBeenCalled();
        expect(sound.play).not.toHaveBeenCalled();
    });

    it('a recording kept long before this screen (an earlier one) does not pop', () => {
        noteVoiceJourney({ kind: 'kept', input: 'audio' }, Date.now() - 10 * 60_000);
        render(<RingWaitScreen />);
        expect(screen.queryByTestId('saved-pop')).not.toBeInTheDocument();
        expect(success).not.toHaveBeenCalled();
    });

    it('it stays while the real answer is pending, however long: only the app\'s status takes it away (no timer)', async () => {
        // The ring stands still here (reduced motion): fast-forwarding ten minutes of animation frames would only make the test slow.
        vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
        let answer: () => void = () => undefined;
        const parse = new Promise<void>((resolve) => { answer = resolve; });
        const Router: React.FC = () => {
            const [status, setStatus] = useState<'processing' | 'success'>('processing');
            useEffect(() => { void parse.then(() => setStatus('success')); }, []);
            return status === 'processing' ? <RingWaitScreen /> : <p data-testid="result">result</p>;
        };
        render(<Router />);
        act(() => { noteVoiceJourney({ kind: 'kept', input: 'audio' }); });
        for (const ms of [5_000, 60_000, 10 * 60_000]) {
            advance(ms);
            expect(screen.getByTestId('ring-wait')).toBeInTheDocument();
            expect(screen.getByTestId('sathi-ring')).toHaveAttribute('data-mode', 'chase');
            expect(litNodes()).toHaveLength(0);
            expect(screen.queryByTestId('result')).not.toBeInTheDocument();
        }
        await act(async () => { answer(); await parse; });
        expect(screen.queryByTestId('ring-wait')).not.toBeInTheDocument();
        expect(screen.getByTestId('result')).toBeInTheDocument();
        vi.unstubAllGlobals();
    });
});
