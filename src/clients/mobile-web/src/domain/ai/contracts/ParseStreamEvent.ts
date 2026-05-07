/**
 * ParseStreamEvent — discriminated union mirror of the backend
 * `ParseStreamEvent` DTO emitted by `POST /shramsafal/ai/parse-voice-stream`
 * (VOICE_LATENCY_PIPELINE_V2 Phase 3).
 *
 * Wire format (proven by AiStreamingEndpointTests.ParseVoiceStream_StreamsExpectedSseEvents):
 *   data: <json>\n\n
 * where <json> deserializes to one variant of the union below.
 *
 * Order guarantee:
 *   `text`           events arrive in chunk order.
 *   `field_complete` events interleave with the `text` chunks that triggered them.
 *   `complete`       arrives last on success.
 *   `error`          arrives last on terminal failure (HTTP 200 already established).
 *
 * Architectural decisions to honor (from Phase 3 backend slice):
 *   - `fieldPath` is currently top-level only (e.g., `"summary"`, `"irrigation"`).
 *     For top-level arrays, the parser fires `field_complete` once per element AND
 *     once for the array itself — both with the same `fieldPath`.
 *   - `fieldValue` is `null` in the current backend implementation. Consumers
 *     should treat it as a "field arrived" signal and re-derive values from the
 *     latest `text` chunks or wait for the `complete` event's `payload`.
 *
 * Layer: Domain (pure types, no imports from UI/infrastructure).
 */

import type { AgriLogResponse } from '../../../types';

export type ParseStreamEvent =
    | {
        type: 'text';
        content: string;
        promptVersion?: string;
    }
    | {
        type: 'field_complete';
        fieldPath: string;
        fieldValue?: unknown;
        promptVersion?: string;
    }
    | {
        type: 'complete';
        payload: AgriLogResponse | null;
        promptVersion?: string;
        modelMs?: number;
    }
    | {
        type: 'error';
        error: string;
        promptVersion?: string;
        modelMs?: number;
    };

export type ParseStreamEventType = ParseStreamEvent['type'];
