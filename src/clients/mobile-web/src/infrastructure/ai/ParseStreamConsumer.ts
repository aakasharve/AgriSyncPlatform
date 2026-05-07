/**
 * ParseStreamConsumer — reads an SSE response from
 * `POST /shramsafal/ai/parse-voice-stream` and yields typed events.
 *
 * Wire framing (per AiStreamingEndpointTests):
 *   `data: <json>\n\n`
 *
 * Chunk-boundary tolerant: a single SSE event may be split across multiple
 * `reader.read()` chunks, and a single chunk may contain multiple events.
 * Anything left in the buffer at end-of-stream that is NOT a complete event
 * is dropped silently (the backend always closes after a terminal `complete`
 * or `error` event, so trailing garbage is never expected).
 *
 * Layer: Infrastructure (browser-only — relies on `Response.body.getReader()`).
 */

import type { ParseStreamEvent } from '../../domain/ai/contracts/ParseStreamEvent';

const SSE_DATA_PREFIX = 'data: ';
const SSE_EVENT_DELIMITER = '\n\n';

export async function* parseStreamConsumer(
    response: Response,
): AsyncIterable<ParseStreamEvent> {
    if (!response.body) {
        throw new Error('parseStreamConsumer: response has no body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                // Flush any final bytes still queued in the decoder.
                buffer += decoder.decode();
                yield* drainBuffer(buffer, /*flushPartial*/ true);
                return;
            }

            buffer += decoder.decode(value, { stream: true });

            const events = buffer.split(SSE_EVENT_DELIMITER);
            // Last fragment may be a partial event — keep for next read.
            buffer = events.pop() ?? '';

            for (const eventText of events) {
                const parsed = parseSseEvent(eventText);
                if (parsed) {
                    yield parsed;
                }
            }
        }
    } finally {
        // Best-effort release; ignore if already released by upstream cancel.
        try {
            reader.releaseLock();
        } catch {
            /* noop */
        }
    }
}

function* drainBuffer(buffer: string, flushPartial: boolean): Generator<ParseStreamEvent> {
    if (!buffer) return;
    const events = buffer.split(SSE_EVENT_DELIMITER);
    const tail = events.pop();
    for (const eventText of events) {
        const parsed = parseSseEvent(eventText);
        if (parsed) yield parsed;
    }
    if (flushPartial && tail) {
        const parsed = parseSseEvent(tail);
        if (parsed) yield parsed;
    }
}

function parseSseEvent(eventText: string): ParseStreamEvent | null {
    // An SSE event block can contain multiple lines (`data:`, `event:`, `id:`, ...).
    // We only consume `data:` lines; the backend never sets `event:` or `id:`.
    const lines = eventText.split('\n');
    for (const line of lines) {
        if (!line.startsWith(SSE_DATA_PREFIX)) continue;
        const payload = line.slice(SSE_DATA_PREFIX.length).trim();
        if (!payload) continue;
        try {
            return JSON.parse(payload) as ParseStreamEvent;
        } catch {
            // Malformed event — drop it. The terminal `error` event still
            // delivers the failure signal even if one chunk is corrupted.
            return null;
        }
    }
    return null;
}
