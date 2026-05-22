/**
 * TranscribeStreamConsumer — opens an SSE stream against
 * `POST /shramsafal/ai/transcribe-stream` (SARVAM_PRIMARY_VOICE_PIPELINE
 * Slice B Task 2.3) and yields typed
 * `transcript_partial` / `transcript_final` / `error` events.
 *
 * <b>Why fetch + ReadableStream and not EventSource.</b> The browser's
 * native `EventSource` API does not support POST (per WHATWG spec), and
 * we need multipart audio in the request body. We use `fetch` with a
 * multipart `FormData` body and read `response.body` as a
 * `ReadableStream<Uint8Array>`, then parse the SSE framing manually.
 *
 * <b>Wire framing</b> (matches `AiTranscribeStreamEndpoints.WriteEventAsync`):
 *   `event: <name>\ndata: <json>\n\n`
 * Two newlines terminate one SSE event. We tolerate the chunk-boundary
 * case (a single event split across multiple `reader.read()` chunks)
 * by buffering until the trailing `\n\n` arrives.
 *
 * Layer: Infrastructure (browser-only — relies on
 * `Response.body.getReader()`).
 */

import type { TranscriptStreamEvent } from '../../domain/ai/contracts/TranscriptStreamEvent';
import { getAuthSession } from '../storage/AuthTokenStore';
import { resolveApiBaseUrl } from '../api/transport';

const SSE_EVENT_DELIMITER = '\n\n';

/**
 * Options accepted by {@link TranscribeStreamConsumer.consume}.
 */
export interface TranscribeStreamOptions {
    /** ISO-8601 UTC timestamp when the audio was captured; optional. */
    recordedAtUtc?: string;
    /** Language hint (default `mr-IN` on the backend). */
    languageHint?: string;
    /** Sarvam STT mode (default `codemix` on the backend). */
    mode?: string;
}

export class TranscribeStreamConsumer {
    /**
     * Opens the SSE stream and yields typed events as they arrive.
     *
     * @param audio        The audio blob to transcribe. The blob's
     *                     `type` field is forwarded as the multipart
     *                     filename Content-Type.
     * @param languageHint Language tag, e.g. `mr-IN`. The default is
     *                     applied server-side when omitted.
     * @param mode         Sarvam STT mode, e.g. `codemix`. The default
     *                     is applied server-side when omitted.
     * @param recordedAtUtc Optional ISO-8601 UTC capture timestamp
     *                     plumbed into the structurer prompt via
     *                     `{{captured_at}}` (Slice B founder fix).
     * @param signal       Cancellation; aborting cancels the in-flight
     *                     fetch and the underlying reader.
     */
    async *consume(
        audio: Blob,
        languageHint: string,
        mode: string,
        recordedAtUtc: string | undefined,
        signal: AbortSignal,
    ): AsyncGenerator<TranscriptStreamEvent, void, unknown> {
        const baseUrl = resolveApiBaseUrl();
        const session = getAuthSession();

        const formData = new FormData();
        // Field name `audio` must match `form.Files["audio"]` in
        // AiTranscribeStreamEndpoints.cs line 102.
        formData.append('audio', audio, 'audio-clip');
        formData.append('language_hint', languageHint);
        formData.append('mode', mode);
        if (recordedAtUtc) {
            formData.append('recorded_at', recordedAtUtc);
        }

        const headers: Record<string, string> = {
            Accept: 'text/event-stream',
        };
        if (session?.accessToken) {
            headers.Authorization = `Bearer ${session.accessToken}`;
        }

        const response = await fetch(`${baseUrl}/shramsafal/ai/transcribe-stream`, {
            method: 'POST',
            headers,
            body: formData,
            signal,
        });

        if (!response.ok || !response.body) {
            // Non-2xx surface — try to parse a single error event from
            // the body, otherwise synthesize one from the HTTP status.
            const text = response.body
                ? await response.text().catch(() => '')
                : '';
            yield {
                type: 'error',
                code: 'http_error',
                message: text || `HTTP ${response.status} ${response.statusText}`,
            };
            return;
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('text/event-stream')) {
            await response.body.cancel().catch(() => undefined);
            yield {
                type: 'error',
                code: 'unexpected_content_type',
                message: `Expected text/event-stream, got "${contentType}".`,
            };
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    buffer += decoder.decode();
                    yield* drainBuffer(buffer);
                    return;
                }

                buffer += decoder.decode(value, { stream: true });

                const events = buffer.split(SSE_EVENT_DELIMITER);
                // Last fragment may be partial — keep for next read.
                buffer = events.pop() ?? '';

                for (const eventText of events) {
                    const parsed = parseSseEvent(eventText);
                    if (parsed) {
                        yield parsed;
                    }
                }
            }
        } finally {
            try {
                reader.releaseLock();
            } catch {
                /* noop — already released by upstream cancel. */
            }
        }
    }
}

function* drainBuffer(buffer: string): Generator<TranscriptStreamEvent> {
    if (!buffer.trim()) return;
    const events = buffer.split(SSE_EVENT_DELIMITER);
    for (const eventText of events) {
        const parsed = parseSseEvent(eventText);
        if (parsed) yield parsed;
    }
}

/**
 * Parse a single SSE event block (`event: <name>\ndata: <json>`) into
 * a {@link TranscriptStreamEvent}. Returns `null` for unknown event
 * names or malformed payloads — the terminal `error` event still
 * surfaces a failure signal even if one event was corrupted.
 */
function parseSseEvent(eventText: string): TranscriptStreamEvent | null {
    let eventName: string | null = null;
    let dataPayload: string | null = null;

    for (const rawLine of eventText.split('\n')) {
        const line = rawLine.trimEnd();
        if (line.startsWith('event:')) {
            eventName = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
            dataPayload = line.slice('data:'.length).trim();
        }
    }

    if (!eventName || !dataPayload) {
        return null;
    }

    let parsedData: unknown;
    try {
        parsedData = JSON.parse(dataPayload);
    } catch {
        return null;
    }

    if (eventName === 'transcript_partial' || eventName === 'transcript_final') {
        const text = isObjectWithText(parsedData) ? parsedData.text : '';
        return {
            type: eventName,
            text,
        };
    }

    if (eventName === 'error') {
        const code = isObjectWithError(parsedData) ? parsedData.code ?? parsedData.error ?? 'error' : 'error';
        const message = isObjectWithError(parsedData) ? parsedData.message ?? '' : '';
        return {
            type: 'error',
            code,
            message,
        };
    }

    return null;
}

function isObjectWithText(value: unknown): value is { text: string } {
    return typeof value === 'object'
        && value !== null
        && 'text' in value
        && typeof (value as { text: unknown }).text === 'string';
}

function isObjectWithError(value: unknown): value is { code?: string; error?: string; message?: string } {
    return typeof value === 'object' && value !== null;
}
