/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 2 + amendments Verifier 1, H1) — the silence help is driven ONLY by the real
 * mic level: no level, no hints (P5); speech is a level held above SPEECH_LEVEL for SPEECH_MIN_MS.
 */
import { describe, expect, it } from 'vitest';
import {
    AUTO_SILENT_CANCEL_MS, COACH_MS, LONG_TALK_MS, QUIET_DONE_MS, SPEECH_LEVEL, SPEECH_MIN_MS, ZERO_UNMEASURABLE_MS,
    silenceStage, silenceStart, silenceStep, silenceUnmeasurable, type SilenceState,
} from '../silenceHelpModel';

const T0 = 1_000_000;
/** Feed `level` every 100 ms from `from` (exclusive of `to`), as the 90 ms meter roughly does. */
function feed(s: SilenceState, level: number | undefined, from: number, to: number): SilenceState {
    let out = s;
    for (let t = from; t < to; t += 100) out = silenceStep(out, level, T0 + t);
    return out;
}

describe('silenceHelpModel', () => {
    it('keeps the plan constants', () => {
        expect(SPEECH_LEVEL).toBe(0.12);
        expect(SPEECH_MIN_MS).toBe(300);
        expect(COACH_MS).toEqual([4000, 9000, 16000]);
        expect(QUIET_DONE_MS).toBe(5000);
        expect(LONG_TALK_MS).toBe(60000);
        expect(AUTO_SILENT_CANCEL_MS).toBe(20000);
        expect(ZERO_UNMEASURABLE_MS).toBe(3000);
    });

    it('coaches at 4 s, 9 s and 16 s of silence, at the exact millisecond edges', () => {
        const s = feed(silenceStart(T0), 0.02, 0, 20_000);
        expect(s.measured).toBe(true);
        expect(silenceStage(s, T0 + 3999)).toBe('none');
        expect(silenceStage(s, T0 + 4000)).toBe('coachOne');
        expect(silenceStage(s, T0 + 8999)).toBe('coachOne');
        expect(silenceStage(s, T0 + 9000)).toBe('coachPrompts');
        expect(silenceStage(s, T0 + 15999)).toBe('coachPrompts');
        expect(silenceStage(s, T0 + 16000)).toBe('stopNote');
    });

    it('undefined levels are never hints (P5)', () => {
        const s = feed(silenceStart(T0), undefined, 0, 30_000);
        expect(s.measured).toBe(false);
        for (const t of [0, 4000, 9000, 16000, 25000]) expect(silenceStage(s, T0 + t)).toBe('none');
        expect(silenceUnmeasurable(s, T0 + 30_000)).toBe(true);
    });

    it('a first ~90 ms of undefined is not latched: real levels after it still coach', () => {
        let s = silenceStep(silenceStart(T0), undefined, T0 + 50);
        s = feed(s, 0.03, 100, 10_000);
        expect(silenceStage(s, T0 + 4000)).toBe('coachOne');
        expect(silenceUnmeasurable(s, T0 + 10_000)).toBe(false);
    });

    it('a level stuck at exactly 0 for 3 s is not measurable (no hints), and real sound makes it measurable again', () => {
        let s = feed(silenceStart(T0), 0, 0, 5000);
        expect(silenceUnmeasurable(s, T0 + 2999)).toBe(false);
        expect(silenceUnmeasurable(s, T0 + 3000)).toBe(true);
        expect(silenceStage(s, T0 + 4500)).toBe('none');
        s = silenceStep(s, 0.02, T0 + 5000);
        expect(silenceUnmeasurable(s, T0 + 5000)).toBe(false);
        expect(silenceStage(s, T0 + 5000)).toBe('coachOne');
    });

    it('a 200 ms blip is not speech; 400 ms is', () => {
        let s = feed(silenceStart(T0), 0.02, 0, 1000);
        s = feed(s, 0.4, 1000, 1200);
        s = feed(s, 0.02, 1200, 2000);
        expect(s.spoke).toBe(false);
        s = feed(s, 0.4, 2000, 2400);
        s = feed(s, 0.02, 2400, 2500);
        expect(s.spoke).toBe(true);
    });

    it('once he spoke, coaching stops; 5 s of quiet asks "finished?", new speech hides it', () => {
        let s = feed(silenceStart(T0), 0.3, 0, 1000);          // speaks for 1 s
        expect(silenceStage(s, T0 + 1000)).toBe('none');
        s = feed(s, 0.02, 1000, 12_000);                       // then quiet
        const lastSpeech = s.lastSpeechAt as number;
        expect(silenceStage(s, lastSpeech + QUIET_DONE_MS - 1)).toBe('none');
        expect(silenceStage(s, lastSpeech + QUIET_DONE_MS)).toBe('doneAsk');
        s = feed(s, 0.3, 12_000, 12_500);                      // speaks again
        expect(silenceStage(s, T0 + 12_500)).toBe('none');
    });

    it('at 60 s of talking the ask shows once even while talking, and is not repeated', () => {
        const s = feed(silenceStart(T0), 0.3, 0, 80_000);
        expect(silenceStage(s, T0 + LONG_TALK_MS - 1)).toBe('none');
        expect(silenceStage(s, T0 + LONG_TALK_MS)).toBe('doneAsk');
        expect(silenceStage(s, T0 + 75_000)).toBe('none');
    });
});
