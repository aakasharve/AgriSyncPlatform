/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-instant-phase-a-2026-11-23 (P4) — which parse failures keep his words and try again, and which never do.
 *
 * Kept (retryable): no answer at all (network, DNS, TLS, timeout, CORS), HTTP 5xx / 408 / 429, and the server's own "the
 * AI failed this time" answer (HTTP 400 carrying `ShramSafal.AiParsingFailed` / `ShramSafal.InvalidAiResponse`).
 * Not kept, unchanged: every other 4xx (validation, consent, forbidden, too large, a gate), an answer that says the input
 * itself is the problem, a cancelled request, and any error of our own that is not an HTTP failure.
 */
import { describe, expect, it } from 'vitest';
import { ONLINE_KEPT_MESSAGE, isKeptMessage, isRetryableParseFailure } from '../keptForLater';

/** An axios-shaped failure, as `agriSyncClient.parseVoiceLog` rejects with. */
const http = (status: number | undefined, data?: unknown, extra: Record<string, unknown> = {}) => Object.assign(new Error(
    status === undefined ? 'Network Error' : `Request failed with status code ${status}`,
), { isAxiosError: true, ...(status !== undefined && { response: { status, data } }), ...extra });

const aiFailed = (message = 'Voice parsing failed. Sarvam STT failed: HTTP 503.') => ({ error: 'ShramSafal.AiParsingFailed', message });

describe('isRetryableParseFailure — the server\'s or the line\'s failure keeps his words', () => {
    it.each([
        ['no answer at all (no network, DNS, TLS, CORS)', http(undefined)],
        ['a timeout', http(undefined, undefined, { code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' })],
        ['HTTP 500', http(500)],
        ['HTTP 502', http(502)],
        ['HTTP 503', http(503)],
        ['HTTP 504', http(504)],
        ['HTTP 408', http(408)],
        ['HTTP 429', http(429)],
        ['the server\'s "AI failed" answer (400 + ShramSafal.AiParsingFailed)', http(400, aiFailed())],
        ['the server\'s "AI returned an invalid answer" (400 + ShramSafal.InvalidAiResponse)', http(400, { error: 'ShramSafal.InvalidAiResponse', message: 'AI parser returned an invalid response payload.' })],
    ])('%s is kept', (_name, error) => {
        expect(isRetryableParseFailure(error)).toBe(true);
    });

    it.each([
        ['a plain validation 400', http(400, { error: 'ShramSafal.InvalidCommand', message: 'farmId is required.' })],
        ['a 400 with no body', http(400)],
        ['a 400 with a body that is not the server\'s', http(400, 'Bad Request')],
        ['a 400 whose code is not the AI one', http(400, { error: 'ShramSafal.MissingVoiceTranscript', message: 'x' })],
        ['an AI failure that says the input itself was refused', http(400, aiFailed('[input-refused] audio is not a supported format'))],
        ['an AI failure that heard nothing', http(400, aiFailed('Transcribe returned empty transcript.'))],
        ['HTTP 401', http(401)],
        ['HTTP 403 (consent, forbidden)', http(403, { error: 'ShramSafal.Forbidden', message: 'x' })],
        ['HTTP 404', http(404)],
        ['HTTP 409', http(409)],
        ['HTTP 413 (too large)', http(413)],
        ['HTTP 422', http(422)],
    ])('%s is NOT kept', (_name, error) => {
        expect(isRetryableParseFailure(error)).toBe(false);
    });

    it('a cancelled request is not a server failure', () => {
        expect(isRetryableParseFailure(http(undefined, undefined, { code: 'ERR_CANCELED' }))).toBe(false);
        expect(isRetryableParseFailure(Object.assign(new Error('canceled'), { name: 'CanceledError', isAxiosError: true }))).toBe(false);
    });

    it('an error of our own that is not an HTTP failure is never dressed up as "the server failed"', () => {
        expect(isRetryableParseFailure(new Error('disk full'))).toBe(false);
        expect(isRetryableParseFailure(new TypeError('x.trim is not a function'))).toBe(false);
        expect(isRetryableParseFailure('Network Error')).toBe(false);
        expect(isRetryableParseFailure(undefined)).toBe(false);
        expect(isRetryableParseFailure(null)).toBe(false);
    });
});

describe('the stable code', () => {
    it('is recognised, and nothing else is', () => {
        expect(isKeptMessage(ONLINE_KEPT_MESSAGE)).toBe(true);
        expect(isKeptMessage('Saved locally. Will process when connected.')).toBe(false);
        expect(isKeptMessage('Voice parsing failed.')).toBe(false);
        expect(isKeptMessage(undefined)).toBe(false);
        expect(isKeptMessage(null)).toBe(false);
    });
});
