/**
 * ParseStreamConsumer tests — VOICE_LATENCY_PIPELINE_V2 Phase 3 Task 3.8.
 *
 * The wire fixture mirrors the exact event sequence emitted by
 * `AiStreamingEndpointTests.ParseVoiceStream_StreamsExpectedSseEvents`
 * (the proven backend wire format).
 */

import { describe, it, expect } from 'vitest';
import { parseStreamConsumer } from '../ParseStreamConsumer';
import type { ParseStreamEvent } from '../../../domain/ai/contracts/ParseStreamEvent';

const FIXTURE_EVENTS = [
    { type: 'text', content: '{"summary":' },
    { type: 'text', content: '"hello",' },
    { type: 'field_complete', fieldPath: 'summary' },
    { type: 'complete', payload: null },
] as const;

function buildSseFrames(events: readonly Record<string, unknown>[]): string {
    return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
}

function responseFromChunks(chunks: readonly Uint8Array[]): Response {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
        },
    });
    return new Response(stream);
}

function utf8(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

async function collect(iter: AsyncIterable<ParseStreamEvent>): Promise<ParseStreamEvent[]> {
    const out: ParseStreamEvent[] = [];
    for await (const event of iter) out.push(event);
    return out;
}

describe('parseStreamConsumer', () => {
    it('yields the full backend event sequence when all bytes arrive in one chunk', async () => {
        const sse = buildSseFrames([...FIXTURE_EVENTS]);
        const response = responseFromChunks([utf8(sse)]);

        const events = await collect(parseStreamConsumer(response));

        expect(events).toHaveLength(FIXTURE_EVENTS.length);
        expect(events[0]).toEqual(FIXTURE_EVENTS[0]);
        expect(events[1]).toEqual(FIXTURE_EVENTS[1]);
        expect(events[2]).toEqual(FIXTURE_EVENTS[2]);
        expect(events[3]).toEqual(FIXTURE_EVENTS[3]);
    });

    it('reassembles events split mid-line across reader chunks', async () => {
        const sse = buildSseFrames([...FIXTURE_EVENTS]);
        // Split aggressively: every 7 bytes — guarantees splits inside JSON
        // payloads, inside `data: ` prefixes, and inside `\n\n` delimiters.
        const bytes = utf8(sse);
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < bytes.length; i += 7) {
            chunks.push(bytes.slice(i, i + 7));
        }
        const response = responseFromChunks(chunks);

        const events = await collect(parseStreamConsumer(response));

        expect(events).toEqual([...FIXTURE_EVENTS]);
    });

    it('reassembles events when the SSE delimiter itself is split across chunks', async () => {
        const first = buildSseFrames(FIXTURE_EVENTS.slice(0, 1));
        const second = buildSseFrames(FIXTURE_EVENTS.slice(1));
        const fullBytes = utf8(first + second);
        // Force the boundary inside the `\n\n` delimiter by splitting one byte
        // before the end of the first frame.
        const splitPoint = utf8(first).length - 1;
        const chunks = [
            fullBytes.slice(0, splitPoint),
            fullBytes.slice(splitPoint),
        ];
        const response = responseFromChunks(chunks);

        const events = await collect(parseStreamConsumer(response));

        expect(events).toEqual([...FIXTURE_EVENTS]);
    });

    it('flushes the trailing event even when the stream ends without a final delimiter', async () => {
        // Backend always closes after a terminal `\n\n`, but we should still
        // surface the last event if the network drops the trailing delimiter.
        const partial = `data: ${JSON.stringify(FIXTURE_EVENTS[0])}\n\n`
            + `data: ${JSON.stringify(FIXTURE_EVENTS[3])}`;
        const response = responseFromChunks([utf8(partial)]);

        const events = await collect(parseStreamConsumer(response));

        expect(events).toEqual([FIXTURE_EVENTS[0], FIXTURE_EVENTS[3]]);
    });

    it('skips malformed event blocks without aborting the stream', async () => {
        const sse = `data: not-json\n\n`
            + `data: ${JSON.stringify(FIXTURE_EVENTS[2])}\n\n`
            + `data: ${JSON.stringify(FIXTURE_EVENTS[3])}\n\n`;
        const response = responseFromChunks([utf8(sse)]);

        const events = await collect(parseStreamConsumer(response));

        expect(events).toEqual([FIXTURE_EVENTS[2], FIXTURE_EVENTS[3]]);
    });

    it('throws when the response has no body', async () => {
        const bodyless = new Response(null);

        await expect(collect(parseStreamConsumer(bodyless))).rejects.toThrow(/no body/);
    });

    it('surfaces a terminal error event as the last yielded value', async () => {
        const errorEvent = { type: 'error', error: 'gemini timeout' };
        const sse = buildSseFrames([FIXTURE_EVENTS[0], errorEvent]);
        const response = responseFromChunks([utf8(sse)]);

        const events = await collect(parseStreamConsumer(response));

        expect(events).toHaveLength(2);
        expect(events[1]).toEqual(errorEvent);
    });
});
