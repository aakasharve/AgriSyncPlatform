/**
 * TranscriptStreamEvent — discriminated union mirror of the backend SSE
 * events emitted by `POST /shramsafal/ai/transcribe-stream`
 * (SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Slice B Task 2.3).
 *
 * Wire format:
 *   event: transcript_partial\ndata: {"text":"..."}\n\n
 *   event: transcript_final\ndata: {"text":"..."}\n\n
 *   event: error\ndata: {"code":"...","message":"..."}\n\n
 *
 * Order guarantee:
 *   `transcript_partial` events arrive in chunk order.
 *   `transcript_final` arrives last on success.
 *   `error` arrives last on terminal failure (HTTP 200 already established).
 *
 * Layer: Domain (pure types — no UI or infrastructure imports allowed).
 */

export type TranscriptStreamEvent =
    | {
        type: 'transcript_partial';
        text: string;
    }
    | {
        type: 'transcript_final';
        text: string;
    }
    | {
        type: 'error';
        code: string;
        message: string;
    };

export type TranscriptStreamEventType = TranscriptStreamEvent['type'];
