/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words, P9) — the one request, and that no way it fails can throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../../../infrastructure/api/apiFetch', () => ({ apiFetch: h.apiFetch }));

import { sendLiveWords, type LiveWordsRequest } from '../liveWordsClient';

const reply = (status: number, body?: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => { if (body === undefined) throw new Error('no body'); return body; },
}) as unknown as Response;

const request = (over: Partial<LiveWordsRequest> = {}): LiveWordsRequest => ({
    wav: new Blob([new Uint8Array(100)], { type: 'audio/wav' }), farmId: 'farm-9', seq: 3, signal: new AbortController().signal, ...over,
});

beforeEach(() => { h.apiFetch.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('sendLiveWords', () => {
    it('posts the phrase to the live-words route with the farm, the number and the language', async () => {
        h.apiFetch.mockResolvedValue(reply(200, { text: ' आज पाच मजूर ', seq: 3 }));

        const answer = await sendLiveWords(request());

        expect(answer).toEqual({ kind: 'words', text: 'आज पाच मजूर' });
        const [path, init] = h.apiFetch.mock.calls[0] as [string, RequestInit];
        expect(path).toBe('/shramsafal/ai/live-words');
        expect(init.method).toBe('POST');
        const form = init.body as FormData;
        expect(form.get('farm_id')).toBe('farm-9');
        expect(form.get('seq')).toBe('3');
        expect(form.get('language_hint')).toBe('mr-IN');
        expect((form.get('audio') as File).size).toBe(100);
    });

    it('a busy server (429, or a 503 that is not "off") is "busy": skip this phrase', async () => {
        h.apiFetch.mockResolvedValueOnce(reply(429, { error: 'ShramSafal.LiveWordsBusy' }));
        expect(await sendLiveWords(request())).toEqual({ kind: 'busy' });
        h.apiFetch.mockResolvedValueOnce(reply(503, { error: 'ShramSafal.LiveWordsUnavailable' }));
        expect(await sendLiveWords(request())).toEqual({ kind: 'busy' });
    });

    it('live words switched off on the server is "off"', async () => {
        h.apiFetch.mockResolvedValue(reply(503, { error: 'ShramSafal.LiveWordsOff' }));
        expect(await sendLiveWords(request())).toEqual({ kind: 'off' });
    });

    it('any other refusal, an old server without the route, or no answer body is "failed", never a throw', async () => {
        for (const status of [400, 401, 403, 404, 500]) {
            h.apiFetch.mockResolvedValueOnce(reply(status, { error: 'x' }));
            expect(await sendLiveWords(request())).toEqual({ kind: 'failed' });
        }
        h.apiFetch.mockResolvedValueOnce(reply(200)); // 200 with a body that is not JSON
        expect(await sendLiveWords(request())).toEqual({ kind: 'failed' });
    });

    it('a network error is "failed"', async () => {
        h.apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));
        expect(await sendLiveWords(request())).toEqual({ kind: 'failed' });
    });

    it('a phrase that has not answered in time is given up: "failed", and its request is cancelled', async () => {
        vi.useFakeTimers();
        let sentSignal: AbortSignal | undefined;
        h.apiFetch.mockImplementation((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
            sentSignal = init.signal as AbortSignal;
            sentSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }));

        const pending = sendLiveWords(request({ timeoutMs: 5000 }));
        await vi.advanceTimersByTimeAsync(5001);

        expect(await pending).toEqual({ kind: 'failed' });
        expect(sentSignal?.aborted).toBe(true);
    });

    it('the session stopping cancels the request in flight', async () => {
        let sentSignal: AbortSignal | undefined;
        h.apiFetch.mockImplementation((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
            sentSignal = init.signal as AbortSignal;
            sentSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }));
        const session = new AbortController();

        const pending = sendLiveWords(request({ signal: session.signal }));
        session.abort();

        expect(await pending).toEqual({ kind: 'failed' });
        expect(sentSignal?.aborted).toBe(true);
    });

    it('a request already cancelled sends nothing', async () => {
        const session = new AbortController();
        session.abort();

        expect(await sendLiveWords(request({ signal: session.signal }))).toEqual({ kind: 'failed' });
        expect(h.apiFetch).not.toHaveBeenCalled();
    });
});
