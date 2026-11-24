/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-instant-phase-a-2026-11-23 (P4, founder 2026-11-24) — his voice is never lost, and he never has to speak
 * again because OUR side failed.
 *
 * Offline, a recording is kept on the phone as a pending AI job and understood later (`offlineVoiceQueue`). Online, a
 * server that fails (Sarvam is the only speech-to-text now: no backup behind it) used to mark the clip `failed` and show
 * an error. A failure that is the SERVER'S or the LINE'S, not a verdict on what he said, keeps the note exactly as the
 * offline path does, and the parse reports this stable code (English: the infrastructure has no language; the recorder
 * shows it in his: `recorderWords.readableError` / `voiceFlowWords.keptForLater`).
 *
 * What is retryable, and what never is:
 *   - retryable: no answer at all (no network, DNS, TLS, a timeout, CORS), 5xx, 408, 429 — the same TRANSPORT line the
 *     sync queue already draws (`RejectionPolicy.categorizePushFailure`) — and the server's own "the AI failed this
 *     time" answer: HTTP 400 carrying `ShramSafal.AiParsingFailed` / `ShramSafal.InvalidAiResponse` (the voice endpoint
 *     maps its internal errors to 400 with `{ error, message }`, `AiEndpoints.ToErrorResult`);
 *   - NOT retryable, unchanged: every other 4xx (validation, consent, forbidden, too large…), an answer that says the
 *     input itself was refused (`[input-refused]`) or heard nothing (an empty transcript), a cancelled request, and any
 *     error of our own that is not an HTTP failure at all.
 *
 * Pure: it reads the error, nothing else.
 */
import { categorizePushFailure } from '../sync/RejectionPolicy';

/** His words are kept on the phone and will be understood shortly: a server or line failure, not a refusal. */
export const ONLINE_KEPT_MESSAGE = 'Kept. Will be understood shortly.';

/** The server's "the AI failed this request" codes (`ShramSafalErrors.AiParsingFailed`, `.InvalidAiResponse`). */
const AI_FAILED_CODES = new Set(['ShramSafal.AiParsingFailed', 'ShramSafal.InvalidAiResponse']);
/** What the server says when the input ITSELF is the problem: trying again cannot help. */
const INPUT_PROBLEM = /\[input-refused\]|empty transcript/i;

interface HttpErrorLike {
    isAxiosError?: boolean;
    code?: string;
    name?: string;
    request?: unknown;
    response?: { status?: unknown; data?: unknown };
}

const isHttpError = (e: HttpErrorLike): boolean => e.isAxiosError === true || 'response' in e || 'request' in e;

/** Did the server answer "the AI failed" (HTTP 400 + its code) — and not "your input is the problem"? */
function aiFailedThisTime(data: unknown): boolean {
    if (typeof data !== 'object' || data === null) return false;
    const { error, message } = data as { error?: unknown; message?: unknown };
    if (typeof error !== 'string' || !AI_FAILED_CODES.has(error)) return false;
    return !(typeof message === 'string' && INPUT_PROBLEM.test(message));
}

/** Is this parse failure the server's or the line's — so his words must be kept and tried again — and not a refusal? */
export function isRetryableParseFailure(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const e = error as HttpErrorLike;
    if (!isHttpError(e)) return false; // our own failure (a disk write, a bug): never dressed up as "the server failed"
    if (e.code === 'ERR_CANCELED' || e.name === 'CanceledError') return false; // he or the app cancelled it
    if (categorizePushFailure(error) === 'TRANSPORT') return true; // no answer, 5xx, 408, 429
    return e.response?.status === 400 && aiFailedThisTime(e.response.data);
}

/** Is this parse result's error the "kept, will be understood shortly" code? */
export const isKeptMessage = (message: string | null | undefined): boolean => message === ONLINE_KEPT_MESSAGE;
