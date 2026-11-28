/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words) — what he is saying is cut into phrases at his pauses.
 */
import { describe, expect, it } from 'vitest';
import { PhraseChunker } from '../phraseChunker';

const RATE = 16000;
const FRAME = 128; // 8 ms: what the recorder's worklet hands over
const loud = (): Float32Array => new Float32Array(FRAME).fill(0.1);
const quiet = (): Float32Array => new Float32Array(FRAME).fill(0.001);
const ms = (n: number) => Math.ceil((n / 1000) * (RATE / FRAME));

function run(chunker: PhraseChunker, parts: Array<['loud' | 'quiet', number]>) {
    const phrases = [];
    for (const [kind, millis] of parts) {
        for (let i = 0; i < ms(millis); i++) {
            const phrase = chunker.feed(kind === 'loud' ? loud() : quiet());
            if (phrase) phrases.push(phrase);
        }
    }
    return phrases;
}

describe('PhraseChunker', () => {
    it('a phrase ends at his pause: speech, then 450 ms of quiet, gives ONE phrase', () => {
        const phrases = run(new PhraseChunker({ sampleRate: RATE }), [['loud', 800], ['quiet', 700]]);

        expect(phrases).toHaveLength(1);
        expect(phrases[0].sampleRate).toBe(RATE);
        expect(phrases[0].speechMs).toBeGreaterThanOrEqual(800);
        expect(phrases[0].speechMs).toBeLessThan(900);
        // the phrase holds the speech plus the quiet that ended it (about 450 ms), not the 700 ms of quiet he was given
        const seconds = phrases[0].pcm.length / RATE;
        expect(seconds).toBeGreaterThan(1.2);
        expect(seconds).toBeLessThan(1.5);
    });

    it('a quiet room makes no phrase at all', () => {
        expect(run(new PhraseChunker({ sampleRate: RATE }), [['quiet', 5000]])).toHaveLength(0);
    });

    it('a click or cough (under half a second of sound) is dropped, not sent', () => {
        expect(run(new PhraseChunker({ sampleRate: RATE }), [['loud', 100], ['quiet', 800]])).toHaveLength(0);
    });

    it('a short breath inside a sentence does not end the phrase', () => {
        const phrases = run(new PhraseChunker({ sampleRate: RATE }), [['loud', 700], ['quiet', 250], ['loud', 700], ['quiet', 700]]);
        expect(phrases).toHaveLength(1);
        expect(phrases[0].speechMs).toBeGreaterThanOrEqual(1400);
    });

    it('speech with no pause is cut at 7 seconds, so the words keep coming', () => {
        const phrases = run(new PhraseChunker({ sampleRate: RATE }), [['loud', 15_000]]);

        expect(phrases).toHaveLength(2);
        for (const p of phrases) expect(p.pcm.length / RATE).toBeLessThan(7.1);
    });

    it('two sentences with a pause between are two phrases, in order', () => {
        const phrases = run(new PhraseChunker({ sampleRate: RATE }), [['loud', 900], ['quiet', 600], ['loud', 1300], ['quiet', 600]]);

        expect(phrases).toHaveLength(2);
        expect(phrases[0].speechMs).toBeLessThan(phrases[1].speechMs);
    });

    it('the phrase starts with a short lead-in of quiet, so its first word is not clipped', () => {
        const phrases = run(new PhraseChunker({ sampleRate: RATE }), [['quiet', 2000], ['loud', 800], ['quiet', 700]]);

        expect(phrases).toHaveLength(1);
        const lead = phrases[0].pcm.findIndex(v => Math.abs(v) > 0.05);
        expect(lead / RATE).toBeGreaterThanOrEqual(0.19);
        expect(lead / RATE).toBeLessThan(0.3);
    });

    it('it keeps its own copy: changing the recorder\'s buffer afterwards changes nothing', () => {
        const chunker = new PhraseChunker({ sampleRate: RATE });
        const shared = loud();
        chunker.feed(shared);
        shared.fill(0.9);
        const phrases = run(chunker, [['loud', 700], ['quiet', 700]]);

        expect(phrases[0].pcm[0]).toBeCloseTo(0.1, 5);
    });

    it('reset() drops the phrase in progress', () => {
        const chunker = new PhraseChunker({ sampleRate: RATE });
        run(chunker, [['loud', 700]]);
        chunker.reset();

        expect(run(chunker, [['quiet', 700]])).toHaveLength(0);
    });

    it('works at the rate the phone really gives (48 kHz): the same milliseconds', () => {
        const chunker = new PhraseChunker({ sampleRate: 48000 });
        const frames = (millis: number) => Math.ceil((millis / 1000) * (48000 / FRAME));
        const out = [];
        for (let i = 0; i < frames(800); i++) { const p = chunker.feed(loud()); if (p) out.push(p); }
        for (let i = 0; i < frames(700); i++) { const p = chunker.feed(quiet()); if (p) out.push(p); }

        expect(out).toHaveLength(1);
        expect(out[0].sampleRate).toBe(48000);
        expect(out[0].speechMs).toBeGreaterThanOrEqual(800);
    });
});
