// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * speakUnlockReward — Task 8 (spec: dfes-companion-2026-07-11). Asserts the
 * guarded no-op (absent speechSynthesis), the happy-path utterance shape
 * (mr-IN, gentle rate, exact text), and that an engine-thrown error is
 * swallowed — this is a reward line, it must never throw or block.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { speakUnlockReward } from '../speakUnlockReward';

// jsdom does not implement the Web Speech API, so production code's
// `new SpeechSynthesisUtterance(...)` needs a minimal stand-in for these
// tests — mirrors how a real engine would populate text/lang/rate.
class FakeSpeechSynthesisUtterance {
    text: string;
    lang = '';
    rate = 1;
    constructor(text: string) {
        this.text = text;
    }
}

describe('speakUnlockReward', () => {
    afterEach(() => {
        delete (window as { speechSynthesis?: unknown }).speechSynthesis;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('is a clean no-op when speechSynthesis is unavailable (no throw)', () => {
        // @ts-expect-error — simulate a device/browser with no speechSynthesis
        delete window.speechSynthesis;
        expect(() => speakUnlockReward('शाब्बास!')).not.toThrow();
    });

    it('speaks an mr-IN utterance with the exact passed line at a gentle rate', () => {
        vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance);
        const speak = vi.fn();
        (window as unknown as { speechSynthesis: { speak: typeof speak } }).speechSynthesis = { speak };

        speakUnlockReward('शाब्बास !!! आता मला तुमचं शेत आणि तुमची काम करण्याची पद्धत सविस्तर समजू लागली आहे');

        expect(speak).toHaveBeenCalledTimes(1);
        const utterance = speak.mock.calls[0][0] as FakeSpeechSynthesisUtterance;
        expect(utterance.lang).toBe('mr-IN');
        expect(utterance.text).toBe('शाब्बास !!! आता मला तुमचं शेत आणि तुमची काम करण्याची पद्धत सविस्तर समजू लागली आहे');
        expect(utterance.rate).toBeLessThan(1);
    });

    it('swallows a thrown engine error — never throws, never blocks the caller', () => {
        vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance);
        (window as unknown as { speechSynthesis: { speak: () => void } }).speechSynthesis = {
            speak: () => {
                throw new Error('engine exploded');
            },
        };

        expect(() => speakUnlockReward('शाब्बास!')).not.toThrow();
    });
});
