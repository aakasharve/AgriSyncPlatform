// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-instant-phase-a-2026-11-23 (Task 0, phone half) — the voice upload reports ONE `voice_timing` record with
 * the server's `Server-Timing` total, and is otherwise exactly what it was: the same URL, the same form, the same answer.
 * A failed request records nothing and leaves no marks behind for the next one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('../../observability/Logger', () => ({ logger: { info: h.info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { parseVoiceLog } from '../resources/AiResource';
import { markVoice, resetVoiceTimingForTests } from '../../voice/voiceTiming';
import type { HttpTransport } from '../transport';

let now = 0;
const at = (ms: number) => { now = ms; };

const BLOB = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
const ANSWER = { success: true, parsedLog: {} };

/** A transport whose POST reports its upload (as axios does) and then answers with `headers`. */
function transport(headers: Record<string, string>, fail?: Error) {
    const post = vi.fn(async (_url: string, _body: unknown, config?: { onUploadProgress?: (e: { loaded: number; total: number }) => void }) => {
        at(2100); config?.onUploadProgress?.({ loaded: 3, total: 3 });
        at(7000);
        if (fail) throw fail;
        return { data: ANSWER, headers };
    });
    return { post, t: { http: { post }, authHttp: {} } as unknown as HttpTransport };
}

/** He stopped at 1 s, the clip row was written at 1.4 s, then the upload is about to start at 1.5 s. */
function recordingStopped() {
    at(1000); markVoice('stop');
    at(1400); markVoice('ack');
    at(1500);
}

beforeEach(() => {
    resetVoiceTimingForTests();
    h.info.mockClear();
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('parseVoiceLog — measured, and otherwise unchanged', () => {
    it('sends the same request and returns the same answer, and emits one voice_timing with serverMs from the header', async () => {
        const { post, t } = transport({ 'server-timing': 's3;dur=120, stt;dur=2400, struct;dur=3100, total;dur=5800' });
        recordingStopped();

        const answer = await parseVoiceLog(t, BLOB, 'audio/webm', { a: 1 }, 'farm-1', { idempotencyKey: 'k1', inputRawDurationMs: 31_400 });

        expect(answer).toBe(ANSWER);
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0][0]).toBe('/shramsafal/ai/voice-parse');
        const form = post.mock.calls[0][1] as FormData;
        expect(form.get('farmId')).toBe('farm-1');
        expect(form.get('idempotencyKey')).toBe('k1');
        expect(h.info).toHaveBeenCalledTimes(1);
        expect(h.info).toHaveBeenCalledWith('voice_timing', expect.objectContaining({
            serverMs: 5800, stopToAckMs: 400, stopToUploadStartMs: 500, uploadMs: 600, stopToResultMs: 6000, recordingMs: 31_400,
        }));
    });

    it('with no Server-Timing header (the server has not shipped it, or CORS hides it) the record has no serverMs', async () => {
        const { t } = transport({});
        recordingStopped();

        await parseVoiceLog(t, BLOB, 'audio/webm', {}, 'farm-1');

        expect(h.info).toHaveBeenCalledTimes(1);
        const record = h.info.mock.calls[0][1] as Record<string, unknown>;
        expect(record).not.toHaveProperty('serverMs');
        expect(record.stopToResultMs).toBe(6000);
    });

    it('a failed request records nothing and leaves no marks for the next request', async () => {
        const { t } = transport({}, new Error('Network Error'));
        recordingStopped();

        await expect(parseVoiceLog(t, BLOB, 'audio/webm', {}, 'farm-1')).rejects.toThrow('Network Error');
        expect(h.info).not.toHaveBeenCalled();

        // The job the offline queue sends later finds no stop and no phone write: it records nothing either.
        const later = transport({ 'server-timing': 'total;dur=900' });
        await parseVoiceLog(later.t, BLOB, 'audio/webm', {}, 'farm-1');
        expect(h.info).not.toHaveBeenCalled();
    });

    it('a request with no recording behind it (the queue\'s job) records nothing', async () => {
        const { t } = transport({ 'server-timing': 'total;dur=900' });
        await parseVoiceLog(t, BLOB, 'audio/webm', {}, 'farm-1');
        expect(h.info).not.toHaveBeenCalled();
    });
});
