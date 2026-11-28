/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words, founder 28 Nov 2026) — one recording's live words.
 *
 * What it does: the recorder feeds it a COPY of every sound frame; it cuts the sound into phrases at his pauses, sends each phrase to
 * the server as soon as it ends (one at a time), and hands the words back in order. So the words appear a phrase at a time, a
 * couple of seconds after each short pause: they are heard words in plain text, NOT sorted into parts (that happens only after he
 * stops, from the real answer).
 *
 * What it never does (P9): it never touches what is recorded, uploaded as his recording, saved or parsed. Whatever goes wrong (no
 * network, a slow or busy server, an old server without the route, the feature switched off) it stays quiet and the recording goes
 * on exactly as before. The final transcript is always the batch path's own.
 *
 * Costs it keeps small, because they are real: one request in flight at a time, at most `maxQueued` waiting (older ones are dropped,
 * never piled up), at most `maxSpeechSec` of speech sent per recording, nothing sent on a data-saver or 2G connection or while offline,
 * and it gives up after `maxFailures` failures in a row.
 */
import { PhraseChunker, type Phrase, type PhraseChunkerConfig } from './phraseChunker';
import { sendLiveWords, type LiveWordsAnswer, type LiveWordsRequest } from './liveWordsClient';
import { wav16Of } from './wav16';

export interface LiveWordsConfig {
    /** Phrases waiting for the one in flight; a newer phrase pushes the oldest out. */
    maxQueued: number;
    /** Speech sent for live words per recording (about 90 s = 2.8 MB of 16 kHz sound at most). */
    maxSpeechSec: number;
    /** Failures in a row before it gives up for this recording. */
    maxFailures: number;
    /** After the server says busy, phrases are skipped for this long. */
    busyBackoffMs: number;
    /** The last this-many characters stay on the strip (older words scroll out). */
    keepChars: number;
}

export const DEFAULT_LIVE_WORDS_CONFIG: LiveWordsConfig = {
    maxQueued: 2,
    maxSpeechSec: 90,
    maxFailures: 3,
    busyBackoffMs: 3000,
    keepChars: 160,
};

export interface LiveWordsSessionOptions {
    farmId: string;
    sampleRate: number;
    /** Called with the words so far (the tail that fits the strip) each time a phrase's words arrive. */
    onWords: (text: string) => void;
    config?: Partial<LiveWordsConfig>;
    chunker?: Partial<PhraseChunkerConfig>;
    /** Test seams. */
    send?: (req: LiveWordsRequest) => Promise<LiveWordsAnswer>;
    now?: () => number;
    /** false = the connection is one not to spend data on (offline, data saver, 2G). */
    connectionOk?: () => boolean;
}

/** A connection live words may use: online, not on data-saver, not 2G. Unknown = fine. */
export function liveWordsConnectionOk(): boolean {
    if (typeof navigator === 'undefined') return true;
    if (navigator.onLine === false) return false;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData === true) return false;
    const type = connection?.effectiveType;
    return !(type === 'slow-2g' || type === '2g');
}

/** The tail of `text` that fits, cut at a word, with a leading "… " when older words were left out. */
export function tailOf(text: string, keep: number): string {
    if (text.length <= keep) return text;
    const cut = text.slice(text.length - keep);
    const space = cut.indexOf(' ');
    return `… ${space >= 0 ? cut.slice(space + 1) : cut}`;
}

export class LiveWordsSession {
    private readonly cfg: LiveWordsConfig;
    private readonly chunker: PhraseChunker;
    private readonly send: (req: LiveWordsRequest) => Promise<LiveWordsAnswer>;
    private readonly now: () => number;
    private readonly connectionOk: () => boolean;
    private readonly abort = new AbortController();
    private readonly queue: Phrase[] = [];
    private readonly phrases: string[] = [];
    private busy = false;
    private seq = 0;
    private speechSentMs = 0;
    private failures = 0;
    private skipUntil = 0;
    private done = false;
    /** The per-recording allowance is used up: nothing new is sent, but the phrase in flight still reports its words. */
    private capped = false;

    constructor(private readonly options: LiveWordsSessionOptions) {
        this.cfg = { ...DEFAULT_LIVE_WORDS_CONFIG, ...options.config };
        this.chunker = new PhraseChunker({ sampleRate: options.sampleRate, ...options.chunker });
        this.send = options.send ?? sendLiveWords;
        this.now = options.now ?? Date.now;
        this.connectionOk = options.connectionOk ?? liveWordsConnectionOk;
    }

    /** The words so far (what the strip shows). */
    get text(): string {
        return tailOf(this.phrases.join(' '), this.cfg.keepChars);
    }

    /** True once it has given up (switched off, too many failures, stopped, or its allowance is used up): feeding it is then free. */
    get finished(): boolean {
        return this.done || this.capped;
    }

    /** One frame of what he is saying (the recorder's own, copied here). Never throws. */
    feed(frame: Float32Array): void {
        if (this.done || this.capped) return;
        try {
            const phrase = this.chunker.feed(frame);
            if (phrase) this.enqueue(phrase);
        } catch {
            this.stop(); // display only: a bug here must never reach the recording
        }
    }

    /** Ends the session: the phrase in flight is given up, nothing more is sent, and no more words are reported. */
    stop(): void {
        this.done = true;
        this.queue.length = 0;
        this.chunker.reset();
        this.abort.abort();
    }

    private enqueue(phrase: Phrase): void {
        if (this.now() < this.skipUntil || !this.connectionOk()) return;
        if (this.speechSentMs + phrase.speechMs > this.cfg.maxSpeechSec * 1000) {
            this.capped = true; // the per-recording allowance is used up: quiet from here on, the strip keeps what it has
            return;
        }
        this.queue.push(phrase);
        while (this.queue.length > this.cfg.maxQueued) this.queue.shift(); // older phrases give way to newer ones
        void this.pump();
    }

    private async pump(): Promise<void> {
        if (this.busy || this.done) return;
        const phrase = this.queue.shift();
        if (!phrase) return;
        this.busy = true;
        this.speechSentMs += phrase.speechMs;
        const seq = ++this.seq;
        let answer: LiveWordsAnswer;
        try {
            answer = await this.send({ wav: wav16Of(phrase.pcm, phrase.sampleRate), farmId: this.options.farmId, seq, signal: this.abort.signal });
        } catch {
            answer = { kind: 'failed' };
        }
        this.busy = false;
        if (this.done) return;
        this.take(answer);
        void this.pump();
    }

    private take(answer: LiveWordsAnswer): void {
        switch (answer.kind) {
            case 'words':
                this.failures = 0;
                if (answer.text) {
                    this.phrases.push(answer.text);
                    try { this.options.onWords(this.text); } catch { /* display only */ }
                }
                return;
            case 'busy':
                this.failures = 0;
                this.skipUntil = this.now() + this.cfg.busyBackoffMs;
                this.queue.length = 0;
                return;
            case 'off':
                this.done = true;
                this.queue.length = 0;
                return;
            default:
                if (++this.failures >= this.cfg.maxFailures) {
                    this.done = true;
                    this.queue.length = 0;
                }
        }
    }
}
