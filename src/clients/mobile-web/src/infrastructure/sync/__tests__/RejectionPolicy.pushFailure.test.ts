/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T3 — finding R1.
 *
 * `categorizePushFailure` is the one place that decides whether a failed push
 * costs a record a retry. Get it wrong toward REJECTION and 75 seconds of bad
 * signal permanently strands a farmer's day; get it wrong toward TRANSPORT and
 * a genuinely broken payload is re-sent until the battery dies. Both directions
 * are asserted here.
 */
import { describe, it, expect } from 'vitest';

import { categorizePushFailure } from '../RejectionPolicy';

/** An axios error with no `response` — nothing ever reached a server. */
function networkError(message = 'Network Error'): Error {
    return Object.assign(new Error(message), { isAxiosError: true, code: 'ERR_NETWORK' });
}

/** An axios error carrying a real HTTP response. */
function httpError(status: number): Error {
    return Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status, data: {} },
    });
}

describe('categorizePushFailure — a record is only charged for its OWN faults', () => {
    describe('TRANSPORT: no verdict about the row ever came back', () => {
        it('classifies a bare network error as transport', () => {
            expect(categorizePushFailure(networkError())).toBe('TRANSPORT');
        });

        it('classifies a timeout as transport', () => {
            expect(categorizePushFailure(networkError('timeout of 15000ms exceeded'))).toBe('TRANSPORT');
        });

        it('classifies a hibernated backend (connection refused) as transport', () => {
            expect(categorizePushFailure(networkError('connect ECONNREFUSED 43.205.20.55:443'))).toBe('TRANSPORT');
        });

        it.each([500, 502, 503, 504])('classifies HTTP %i as transport — the server is unavailable, the row is not wrong', (status) => {
            expect(categorizePushFailure(httpError(status))).toBe('TRANSPORT');
        });

        it('classifies HTTP 429 as transport — "not now" is not "never"', () => {
            expect(categorizePushFailure(httpError(429))).toBe('TRANSPORT');
        });

        it('classifies HTTP 408 as transport', () => {
            expect(categorizePushFailure(httpError(408))).toBe('TRANSPORT');
        });

        it('treats an unrecognisable throw as transport rather than guessing against the record', () => {
            expect(categorizePushFailure(undefined)).toBe('TRANSPORT');
            expect(categorizePushFailure(null)).toBe('TRANSPORT');
            expect(categorizePushFailure('boom')).toBe('TRANSPORT');
            expect(categorizePushFailure(new Error('plain'))).toBe('TRANSPORT');
            expect(categorizePushFailure({ response: null })).toBe('TRANSPORT');
            expect(categorizePushFailure({ response: { status: 'nonsense' } })).toBe('TRANSPORT');
        });
    });

    describe('REJECTION: the server read the request and refused it', () => {
        it.each([400, 401, 403, 404, 409, 413, 422])('classifies HTTP %i as a rejection that counts', (status) => {
            expect(categorizePushFailure(httpError(status))).toBe('REJECTION');
        });

        it('keeps a bound on bad payloads — 400 must never be excused as transport', () => {
            // If this flips, a permanently-malformed batch retries every 15
            // seconds forever and the farmer is never told anything is wrong.
            expect(categorizePushFailure(httpError(400))).not.toBe('TRANSPORT');
        });
    });

    describe('the 499/500 boundary is where availability starts', () => {
        it('499 is a rejection and 500 is transport', () => {
            expect(categorizePushFailure(httpError(499))).toBe('REJECTION');
            expect(categorizePushFailure(httpError(500))).toBe('TRANSPORT');
        });
    });
});
