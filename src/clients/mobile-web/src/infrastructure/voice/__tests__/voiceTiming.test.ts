// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-instant-phase-a-2026-11-23 (Task 0, phone half) — one `voice_timing` record per recording, built from real
 * marks of the save path (stop → ack → upload → result) and the server's `Server-Timing` header when there is one. It
 * measures only the interactive parse, never a job the offline queue sends later, and it never throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('../../observability/Logger', () => ({ logger: { info: h.info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
    endVoiceTiming, finishVoiceTiming, markVoice, noteUploadProgress, parseServerTiming, resetVoiceTimingForTests,
} from '../voiceTiming';
import { noteVoiceJourney, resetVoiceJourneyForTests } from '../voiceJourneySignal';

const HEADER = 's3;dur=120, stt;dur=2400, struct;dur=3100, total;dur=5800';

/** The clock the marks read: each call to `at(ms)` sets what `performance.now()` answers next. */
let now = 0;
const at = (ms: number) => { now = ms; };

beforeEach(() => {
    resetVoiceTimingForTests();
    resetVoiceJourneyForTests();
    h.info.mockClear();
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => { vi.restoreAllMocks(); });

/** A whole interactive recording: stop at 1 s, written on the phone at 1.4 s, request out at 1.5 s, bytes there at 2.1 s. */
function interactive() {
    at(1000); markVoice('stop');
    at(1400); markVoice('ack');
    at(1500); markVoice('upload-start');
    at(2100); noteUploadProgress({ loaded: 90_000, total: 90_000 });
}

describe('parseServerTiming', () => {
    it('reads the four stages the server names, in milliseconds', () => {
        expect(parseServerTiming(HEADER)).toEqual({ s3: 120, stt: 2400, struct: 3100, total: 5800 });
    });
    it('ignores what it does not know, and anything that is not a header', () => {
        expect(parseServerTiming('db;dur=3, total;dur=40.6, cache;desc="hit"')).toEqual({ total: 41 });
        expect(parseServerTiming('total;dur=-5, stt;dur=abc, struct')).toEqual({});
        expect(parseServerTiming(undefined)).toEqual({});
        expect(parseServerTiming(42)).toEqual({});
    });
});

describe('finishVoiceTiming — the one record of a recording', () => {
    it('carries every measured field, with the server total from the header', () => {
        interactive();
        at(7000);
        const record = finishVoiceTiming({ 'server-timing': HEADER }, { recordingMs: 31_400 });

        expect(record).toMatchObject({
            stopToAckMs: 400, stopToUploadStartMs: 500, uploadMs: 600, serverMs: 5800, stopToResultMs: 6000, recordingMs: 31_400,
            serverStagesMs: { s3: 120, stt: 2400, struct: 3100 },
        });
        expect(typeof record?.networkType).toBe('string');
        expect(['low', 'mid', 'high', 'unknown']).toContain(record?.memoryClass);
        expect(h.info).toHaveBeenCalledTimes(1);
        expect(h.info).toHaveBeenCalledWith('voice_timing', expect.objectContaining({ serverMs: 5800, stopToResultMs: 6000 }));
    });

    it('reads the header from an axios-style headers object too', () => {
        interactive();
        at(3000);
        const record = finishVoiceTiming({ get: (name: string) => (name === 'server-timing' ? 'total;dur=900' : undefined) });
        expect(record?.serverMs).toBe(900);
    });

    it('works when the server sends no Server-Timing: serverMs is simply omitted', () => {
        interactive();
        at(7000);
        const record = finishVoiceTiming({}, {});
        expect(record).not.toBeNull();
        expect(record).not.toHaveProperty('serverMs');
        expect(record).not.toHaveProperty('serverStagesMs');
        expect(record?.stopToResultMs).toBe(6000);
        expect(h.info).toHaveBeenCalledTimes(1);
    });

    it('a request that never reported its bytes has no upload time (nothing invented)', () => {
        at(1000); markVoice('stop'); at(1400); markVoice('ack'); at(1500); markVoice('upload-start');
        at(4000);
        expect(finishVoiceTiming({})).not.toHaveProperty('uploadMs');
    });

    it('upload progress below the whole does not finish the upload; the first whole one does, once', () => {
        at(1000); markVoice('stop'); at(1400); markVoice('ack'); at(1500); markVoice('upload-start');
        at(1800); noteUploadProgress({ loaded: 40, total: 100 });
        at(2000); noteUploadProgress({ loaded: 100, total: 100 });
        at(2500); noteUploadProgress({ loaded: 100, total: 100 });
        at(3000);
        expect(finishVoiceTiming({})?.uploadMs).toBe(500);
    });

    it('a job sent later by the offline queue (no phone write after a stop) records nothing', () => {
        at(1000); markVoice('stop'); // he recorded offline: no ack
        at(9_000_000); markVoice('upload-start');
        expect(finishVoiceTiming({ 'server-timing': HEADER })).toBeNull();
        expect(h.info).not.toHaveBeenCalled();
    });

    it('with no recording at all there is nothing to measure', () => {
        markVoice('upload-start');
        expect(finishVoiceTiming({})).toBeNull();
    });

    it('endVoiceTiming wipes the timeline: one recording\'s marks never reach the next request', () => {
        interactive();
        endVoiceTiming();
        at(8000); markVoice('upload-start');
        expect(finishVoiceTiming({})).toBeNull();
    });

    it('a new stop starts a new recording', () => {
        interactive();
        at(5000); markVoice('stop');
        at(5300); markVoice('ack'); at(5400); markVoice('upload-start');
        at(6000);
        expect(finishVoiceTiming({})).toMatchObject({ stopToAckMs: 300, stopToUploadStartMs: 400, stopToResultMs: 1000 });
    });
});

describe('the phone write is the ack', () => {
    it('a kept recording marks the ack; typed words do not', () => {
        at(1000); markVoice('stop');
        at(1250); noteVoiceJourney({ kind: 'kept', input: 'text' });
        at(1400); markVoice('upload-start');
        expect(finishVoiceTiming({})).toBeNull(); // typed words are no recording: no ack

        resetVoiceTimingForTests();
        at(1000); markVoice('stop');
        at(1250); noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: 30_000 });
        at(1400); markVoice('upload-start');
        at(3000);
        expect(finishVoiceTiming({})).toMatchObject({ stopToAckMs: 250, stopToUploadStartMs: 400 });
    });
});
