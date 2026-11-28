/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words) — the one request: a phrase in, its words out
 * (`POST /shramsafal/ai/live-words`). Never throws: every way it can go wrong is an answer, so a caller cannot be hurt by it (P9).
 */
import { apiFetch } from '../../../infrastructure/api/apiFetch';
import { isLiveWordsEnabled } from '../../../app/featureFlags';

export type LiveWordsAnswer =
    /** The words heard in this phrase (may be empty: a pause). */
    | { kind: 'words'; text: string }
    /** The server shed this phrase (too many live pieces, or a rate limit): skip it, try the next. */
    | { kind: 'busy' }
    /** The server has live words switched off: stop for this recording. */
    | { kind: 'off' }
    /** Anything else (not signed in, not allowed, network, timeout): this phrase is lost, nothing else is. */
    | { kind: 'failed' };

export interface LiveWordsRequest {
    wav: Blob;
    farmId: string;
    seq: number;
    languageHint?: string;
    signal: AbortSignal;
    /** A phrase that has not answered by then is given up (its words would arrive after the next ones). */
    timeoutMs?: number;
}

export const LIVE_WORDS_TIMEOUT_MS = 9000;

export async function sendLiveWords(req: LiveWordsRequest): Promise<LiveWordsAnswer> {
    // Founder 28 Nov: no live words for the pilot. The second lock (the recorder already starts no session): with the build
    // switch off nothing is sent, and 'off' ends any session that somehow started.
    if (!isLiveWordsEnabled()) return { kind: 'off' };
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), req.timeoutMs ?? LIVE_WORDS_TIMEOUT_MS);
    const stop = () => timeout.abort();
    if (req.signal.aborted) {
        clearTimeout(timer);
        return { kind: 'failed' };
    }
    req.signal.addEventListener('abort', stop, { once: true });
    try {
        const form = new FormData();
        form.append('farm_id', req.farmId);
        form.append('seq', String(req.seq));
        form.append('language_hint', req.languageHint ?? 'mr-IN');
        form.append('audio', req.wav, 'phrase.wav');
        const response = await apiFetch('/shramsafal/ai/live-words', { method: 'POST', body: form, signal: timeout.signal });
        if (response.status === 429) return { kind: 'busy' };
        if (response.status === 503) {
            const code = await response.json().then((b: { error?: unknown }) => b?.error, () => undefined);
            return code === 'ShramSafal.LiveWordsOff' ? { kind: 'off' } : { kind: 'busy' };
        }
        if (!response.ok) return { kind: 'failed' };
        const body = (await response.json()) as { text?: unknown };
        return { kind: 'words', text: typeof body.text === 'string' ? body.text.trim() : '' };
    } catch {
        return { kind: 'failed' };
    } finally {
        clearTimeout(timer);
        req.signal.removeEventListener('abort', stop);
    }
}
