/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words, P9) — one recording's live words: words arrive in order, a phrase
 * at a time; it spends little and gives up quietly; and it can never reach the recording.
 */
import { describe, expect, it, vi } from 'vitest';
import { LiveWordsSession, tailOf, type LiveWordsSessionOptions } from '../liveWordsSession';
import type { LiveWordsAnswer, LiveWordsRequest } from '../liveWordsClient';

const RATE = 16000;
const FRAME = 128;
const frames = (millis: number) => Math.ceil((millis / 1000) * (RATE / FRAME));

/** One spoken phrase: `speechMs` of sound then a pause that ends it. */
function speak(session: LiveWordsSession, speechMs = 900): void {
    for (let i = 0; i < frames(speechMs); i++) session.feed(new Float32Array(FRAME).fill(0.1));
    for (let i = 0; i < frames(500); i++) session.feed(new Float32Array(FRAME).fill(0.001));
}

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function make(over: Partial<LiveWordsSessionOptions> & { answers?: Array<LiveWordsAnswer | Promise<LiveWordsAnswer>> } = {}) {
    const seen: LiveWordsRequest[] = [];
    const answers = [...(over.answers ?? [])];
    const send = vi.fn(async (req: LiveWordsRequest) => {
        seen.push(req);
        return (await (answers.shift() ?? { kind: 'words', text: `शब्द${seen.length}` })) as LiveWordsAnswer;
    });
    const onWords = vi.fn();
    const { answers: _a, ...rest } = over;
    const session = new LiveWordsSession({ farmId: 'farm-1', sampleRate: RATE, onWords, send, connectionOk: () => true, ...rest });
    return { session, send, seen, onWords };
}

describe('LiveWordsSession — the words', () => {
    it('each phrase\'s words arrive in order and the strip text grows', async () => {
        const { session, send, onWords } = make({ answers: [{ kind: 'words', text: 'आज पाच मजूर होते' }, { kind: 'words', text: 'चार तास फवारणी केली' }] });

        speak(session);
        await flush();
        speak(session);
        await flush();

        expect(send).toHaveBeenCalledTimes(2);
        expect(onWords).toHaveBeenNthCalledWith(1, 'आज पाच मजूर होते');
        expect(onWords).toHaveBeenNthCalledWith(2, 'आज पाच मजूर होते चार तास फवारणी केली');
        expect(session.text).toBe('आज पाच मजूर होते चार तास फवारणी केली');
    });

    it('a phrase is sent with the farm, a rising number and a 16 kHz WAV', async () => {
        const { session, seen } = make();

        speak(session);
        await flush();
        speak(session);
        await flush();

        expect(seen.map(r => [r.farmId, r.seq])).toEqual([['farm-1', 1], ['farm-1', 2]]);
        expect(seen[0].wav.type).toBe('audio/wav');
        expect(seen[0].wav.size).toBeGreaterThan(44);
    });

    it('a pause with no words in it adds nothing', async () => {
        const { session, onWords } = make({ answers: [{ kind: 'words', text: '' }] });

        speak(session);
        await flush();

        expect(onWords).not.toHaveBeenCalled();
        expect(session.text).toBe('');
    });
});

describe('LiveWordsSession — it spends little', () => {
    it('only ONE request is in flight at a time; the next phrase waits for the first', async () => {
        let release: (a: LiveWordsAnswer) => void = () => undefined;
        const first = new Promise<LiveWordsAnswer>(r => { release = r; });
        const { session, send } = make({ answers: [first] });

        speak(session);
        speak(session);
        await flush();
        expect(send).toHaveBeenCalledTimes(1);

        release({ kind: 'words', text: 'एक' });
        await flush();
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('phrases pile up no further than two: older ones give way to newer ones', async () => {
        let release: (a: LiveWordsAnswer) => void = () => undefined;
        const first = new Promise<LiveWordsAnswer>(r => { release = r; });
        const { session, send } = make({ answers: [first] });

        for (let i = 0; i < 5; i++) speak(session); // five phrases while the first is still out
        await flush();
        release({ kind: 'words', text: 'एक' });
        await flush();
        await flush();

        // 1 in flight + 2 kept = 3 requests in all; two phrases were dropped, never queued
        expect(send).toHaveBeenCalledTimes(3);
    });

    it('after "busy" it skips phrases for 3 seconds, then goes on', async () => {
        let t = 1_000_000;
        const { session, send } = make({ now: () => t, answers: [{ kind: 'busy' }] });

        speak(session);
        await flush();
        speak(session); // inside the back-off
        await flush();
        expect(send).toHaveBeenCalledTimes(1);

        t += 3100;
        speak(session);
        await flush();
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('when the server says live words are off, it stops for the recording', async () => {
        const { session, send } = make({ answers: [{ kind: 'off' }] });

        speak(session);
        await flush();
        speak(session);
        await flush();

        expect(send).toHaveBeenCalledTimes(1);
    });

    it('three failures in a row end it; a success in between starts the count again', async () => {
        const failed: LiveWordsAnswer = { kind: 'failed' };
        const ok: LiveWordsAnswer = { kind: 'words', text: 'ठीक' };
        const { session, send } = make({ answers: [failed, failed, ok, failed, failed, failed] });

        for (let i = 0; i < 8; i++) { speak(session); await flush(); }

        expect(send).toHaveBeenCalledTimes(6); // f f ok f f f -> given up; the 7th and 8th phrase are not sent
        expect(session.finished).toBe(true);
    });

    it('it sends nothing while offline, on data-saver or on 2G', async () => {
        const { session, send } = make({ connectionOk: () => false });

        speak(session);
        await flush();

        expect(send).not.toHaveBeenCalled();
    });

    it('it sends at most the allowance of speech per recording, and the phrase in flight still reports its words', async () => {
        const { session, send, onWords } = make({ config: { maxSpeechSec: 2 } });

        speak(session, 900); // 0.9 s
        await flush();
        speak(session, 900); // 1.8 s
        await flush();
        speak(session, 900); // would be 2.7 s: over the allowance
        await flush();

        expect(send).toHaveBeenCalledTimes(2);
        expect(session.finished).toBe(true);
        expect(onWords).toHaveBeenCalledTimes(2);
    });
});

describe('LiveWordsSession — it can never reach the recording (P9)', () => {
    it('stop() gives up the phrase in flight: its words are never reported, and nothing more is sent', async () => {
        let release: (a: LiveWordsAnswer) => void = () => undefined;
        const first = new Promise<LiveWordsAnswer>(r => { release = r; });
        const { session, send, seen, onWords } = make({ answers: [first] });

        speak(session);
        await flush();
        session.stop();
        expect(seen[0].signal.aborted).toBe(true);
        release({ kind: 'words', text: 'देरीने आलेले' });
        await flush();
        speak(session);
        await flush();

        expect(onWords).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledTimes(1);
        expect(session.finished).toBe(true);
    });

    it('a request that throws is a failed phrase, not an exception', async () => {
        const send = vi.fn().mockRejectedValue(new Error('network exploded'));
        const session = new LiveWordsSession({ farmId: 'f', sampleRate: RATE, onWords: vi.fn(), send, connectionOk: () => true });

        expect(() => { speak(session); }).not.toThrow();
        await flush();
        speak(session);
        await flush();
        speak(session);
        await flush();

        expect(session.finished).toBe(true);
    });

    it('a listener that throws does not break the session', async () => {
        const { session, send } = make({ onWords: () => { throw new Error('ui bug'); } });

        speak(session);
        await flush();
        speak(session);
        await flush();

        expect(send).toHaveBeenCalledTimes(2);
    });

    it('feeding a finished session costs nothing and does nothing', () => {
        const { session, send } = make();
        session.stop();

        for (let i = 0; i < 2000; i++) session.feed(new Float32Array(FRAME).fill(0.1));

        expect(send).not.toHaveBeenCalled();
    });
});

describe('tailOf', () => {
    it('keeps text that fits, and cuts the older words (at a word) when it does not', () => {
        expect(tailOf('आज पाच मजूर', 160)).toBe('आज पाच मजूर');
        const long = Array.from({ length: 60 }, (_, i) => `शब्द${i}`).join(' ');
        const tail = tailOf(long, 40);
        expect(tail.startsWith('… ')).toBe(true);
        expect(tail.length).toBeLessThanOrEqual(42);
        expect(tail.endsWith('शब्द59')).toBe(true);
        expect(tail.slice(2).startsWith('शब्द')).toBe(true);
    });
});
