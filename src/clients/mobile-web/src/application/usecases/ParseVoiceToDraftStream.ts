/**
 * ParseVoiceToDraftStream — VOICE_LATENCY_PIPELINE_V2 Phase 3 Task 3.9.
 *
 * Consumes the SSE stream from the backend `parse-voice-stream` endpoint
 * and dispatches typed callbacks. The wizard subscribes to incrementally
 * fill the draft as `field_complete` events arrive and to finalize on
 * `complete`.
 *
 * Architectural note (handoff §100-108):
 *   `fieldValue` is `null` in the current backend implementation. The
 *   wizard should treat `onFieldComplete` as a "field arrived — drop the
 *   skeleton" signal and read concrete values from the `complete` event's
 *   `payload` (or progressive text chunks if it owns its own JSON parser).
 */

import type { AgriLogResponse } from '../../types';
import type { ParseStreamEvent } from '../../domain/ai/contracts/ParseStreamEvent';

export interface ParseVoiceToDraftStreamCallbacks {
    /** Fired once per `text` event with the raw JSON chunk content. */
    onText?: (content: string) => void;
    /** Fired once per top-level field arrival (and once per array element + once per array). */
    onFieldComplete?: (fieldPath: string, fieldValue: unknown) => void;
    /** Fired exactly once on terminal success. `payload` is `null` only if backend signalled a no-op. */
    onComplete?: (payload: AgriLogResponse | null, meta: { promptVersion?: string; modelMs?: number }) => void;
    /** Fired exactly once on terminal failure. */
    onError?: (error: string, meta: { promptVersion?: string; modelMs?: number }) => void;
}

export async function parseVoiceToDraftStream(
    stream: AsyncIterable<ParseStreamEvent>,
    callbacks: ParseVoiceToDraftStreamCallbacks,
): Promise<void> {
    for await (const event of stream) {
        switch (event.type) {
            case 'text':
                callbacks.onText?.(event.content);
                break;
            case 'field_complete':
                callbacks.onFieldComplete?.(event.fieldPath, event.fieldValue);
                break;
            case 'complete':
                callbacks.onComplete?.(event.payload, {
                    promptVersion: event.promptVersion,
                    modelMs: event.modelMs,
                });
                break;
            case 'error':
                callbacks.onError?.(event.error, {
                    promptVersion: event.promptVersion,
                    modelMs: event.modelMs,
                });
                break;
        }
    }
}
