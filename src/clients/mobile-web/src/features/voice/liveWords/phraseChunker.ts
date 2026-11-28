/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words, founder 28 Nov 2026) — cuts what he is saying into PHRASES,
 * as the sound arrives, so each phrase can be turned into words while he goes on speaking.
 *
 * A phrase ends at his pause (`pauseMs` of quiet after speech), or at `maxPhraseMs` when he does not pause. A phrase with less than
 * `minSpeechMs` of speech (a cough, a click) is dropped. The phrase keeps a short lead-in so its first word is not clipped.
 *
 * Display only: this reads a COPY of the frames the recorder already hands to its trimmer and hasher; it never changes what is
 * recorded, saved or sent as his recording.
 */

export interface PhraseChunkerConfig {
    /** The sound's own rate (the recorder's AudioContext rate; 16000 asked, a phone may give 44100 or 48000). */
    sampleRate: number;
    /** A frame whose level is at or above this counts as speech (the recorder's own trimmer threshold). */
    rmsThreshold: number;
    /** Quiet this long after speech ends the phrase. */
    pauseMs: number;
    /** A phrase needs at least this much speech to be worth turning into words. */
    minSpeechMs: number;
    /** A phrase is cut here even without a pause. */
    maxPhraseMs: number;
    /** Quiet kept before the first word. */
    leadInMs: number;
}

export const DEFAULT_PHRASE_CONFIG: Omit<PhraseChunkerConfig, 'sampleRate'> = {
    rmsThreshold: 0.015, // the same as DEFAULT_VOICE_CONFIG.silence.rmsThreshold
    pauseMs: 450,
    minSpeechMs: 500,
    maxPhraseMs: 7000,
    leadInMs: 200,
};

export interface Phrase {
    /** Mono samples at the recorder's own rate, lead-in and trailing quiet included. */
    pcm: Float32Array;
    sampleRate: number;
    /** Milliseconds of actual speech inside (what the speech service will charge for, roughly). */
    speechMs: number;
}

const rmsOf = (frame: Float32Array): number => {
    if (frame.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    return Math.sqrt(sum / frame.length);
};

export class PhraseChunker {
    private readonly cfg: PhraseChunkerConfig;
    /** The quiet just before speech starts: the lead-in. */
    private lead: Float32Array[] = [];
    private leadSamples = 0;
    /** The phrase in progress (empty = none). */
    private frames: Float32Array[] = [];
    private samples = 0;
    private speechSamples = 0;
    private quietRun = 0;

    constructor(config: Partial<PhraseChunkerConfig> & Pick<PhraseChunkerConfig, 'sampleRate'>) {
        this.cfg = { ...DEFAULT_PHRASE_CONFIG, ...config };
    }

    private ms(samples: number): number {
        return (samples / this.cfg.sampleRate) * 1000;
    }

    /** Feeds one frame; returns the phrase this frame completed, or null. */
    feed(frame: Float32Array): Phrase | null {
        // A copy: the worklet's buffer is not ours to keep.
        const owned = new Float32Array(frame);
        const speaking = rmsOf(owned) >= this.cfg.rmsThreshold;

        if (this.frames.length === 0) {
            if (!speaking) {
                this.lead.push(owned);
                this.leadSamples += owned.length;
                while (this.lead.length > 1 && this.ms(this.leadSamples - this.lead[0].length) >= this.cfg.leadInMs) {
                    this.leadSamples -= this.lead[0].length;
                    this.lead.shift();
                }
                return null;
            }
            // Speech starts: the phrase begins with the lead-in.
            this.frames = this.lead;
            this.samples = this.leadSamples;
            this.lead = [];
            this.leadSamples = 0;
        }

        this.frames.push(owned);
        this.samples += owned.length;
        if (speaking) {
            this.speechSamples += owned.length;
            this.quietRun = 0;
        } else {
            this.quietRun += owned.length;
        }

        const paused = this.quietRun > 0 && this.ms(this.quietRun) >= this.cfg.pauseMs;
        const tooLong = this.ms(this.samples) >= this.cfg.maxPhraseMs;
        return paused || tooLong ? this.finish() : null;
    }

    /** Drops whatever is in progress (a cancelled recording, a stop). */
    reset(): void {
        this.lead = [];
        this.leadSamples = 0;
        this.frames = [];
        this.samples = 0;
        this.speechSamples = 0;
        this.quietRun = 0;
    }

    private finish(): Phrase | null {
        const speechMs = this.ms(this.speechSamples);
        const keep = speechMs >= this.cfg.minSpeechMs;
        const pcm = new Float32Array(this.samples);
        let at = 0;
        for (const f of this.frames) {
            pcm.set(f, at);
            at += f.length;
        }
        this.reset();
        return keep ? { pcm, sampleRate: this.cfg.sampleRate, speechMs: Math.round(speechMs) } : null;
    }
}
