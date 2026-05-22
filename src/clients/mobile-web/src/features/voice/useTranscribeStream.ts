/**
 * useTranscribeStream — React hook that integrates
 * {@link TranscribeStreamConsumer} with component state. Exposes a
 * `startTranscribe(audio, opts)` action that opens the SSE stream and
 * surfaces `partialTranscript` + `finalTranscript` + `error` + the
 * `isStreaming` lifecycle flag.
 *
 * <b>Layer.</b> Feature hook — wraps an infrastructure consumer with
 * React state. Components consume only the returned API; they never
 * touch the underlying fetch or SSE plumbing.
 *
 * <b>Cancellation.</b> An internal `AbortController` is fanned out to
 * the consumer. Calling `stop()` aborts the in-flight stream. The hook
 * also aborts on unmount so an unmount mid-stream doesn't leak the
 * underlying connection.
 *
 * <b>Partial-transcript merge.</b> Sarvam saaras V3's streaming mode
 * emits incremental partial transcripts that grow with each chunk
 * (the latest partial is the full assembled transcript up to that
 * point). Per the backend's `assembled.ToString()` concatenation
 * (see AiTranscribeStreamEndpoints.cs L278), the wire sends each
 * partial chunk as the DELTA. We accumulate deltas into
 * `partialTranscript`. If a future backend revision starts sending
 * partials as the running total instead, swap the `+=` for a
 * straight assignment — call sites are unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    TranscribeStreamConsumer,
    type TranscribeStreamOptions,
} from '../../infrastructure/ai/TranscribeStreamConsumer';
import type { TranscriptStreamEvent } from '../../domain/ai/contracts/TranscriptStreamEvent';

export interface UseTranscribeStreamApi {
    /** Start the SSE stream. Resolves when the stream terminates. */
    startTranscribe: (audio: Blob, opts?: TranscribeStreamOptions) => Promise<void>;
    /** Abort any in-flight stream. Safe to call when idle. */
    stop: () => void;
    /** Live-caption text — grows as `transcript_partial` events arrive. */
    partialTranscript: string;
    /** Final transcript text — set when `transcript_final` arrives. */
    finalTranscript: string | null;
    /** Error message — set when an `error` event arrives or fetch throws. */
    error: string | null;
    /** True while an SSE stream is active. */
    isStreaming: boolean;
}

export function useTranscribeStream(): UseTranscribeStreamApi {
    const [partialTranscript, setPartialTranscript] = useState('');
    const [finalTranscript, setFinalTranscript] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isStreaming, setIsStreaming] = useState(false);

    const abortControllerRef = useRef<AbortController | null>(null);
    const consumerRef = useRef<TranscribeStreamConsumer | null>(null);
    if (!consumerRef.current) {
        consumerRef.current = new TranscribeStreamConsumer();
    }

    const stop = useCallback(() => {
        const ctrl = abortControllerRef.current;
        if (ctrl) {
            ctrl.abort();
            abortControllerRef.current = null;
        }
    }, []);

    const startTranscribe = useCallback(
        async (audio: Blob, opts?: TranscribeStreamOptions): Promise<void> => {
            // Reset state so a re-run on the same hook instance does not
            // surface stale captions / errors from a previous attempt.
            setPartialTranscript('');
            setFinalTranscript(null);
            setError(null);
            setIsStreaming(true);

            // Abort any previously-in-flight stream before opening a new
            // one. Defensive — the typical flow is one stream per
            // recording but the API does not enforce that contract.
            const previous = abortControllerRef.current;
            if (previous) {
                previous.abort();
            }

            const controller = new AbortController();
            abortControllerRef.current = controller;

            try {
                const consumer = consumerRef.current!;
                for await (const event of consumer.consume(
                    audio,
                    opts?.languageHint ?? 'mr-IN',
                    opts?.mode ?? 'codemix',
                    opts?.recordedAtUtc,
                    controller.signal,
                )) {
                    if (controller.signal.aborted) {
                        break;
                    }
                    applyEvent(event);
                }
            } catch (err) {
                // Fetch-level error (network down, CORS, etc) or any
                // exception thrown inside the iterator. AbortError is
                // a normal cancellation, not an error.
                if (controller.signal.aborted) {
                    return;
                }
                const message =
                    err instanceof Error && err.message
                        ? err.message
                        : 'Voice transcribe stream failed.';
                setError(message);
            } finally {
                if (abortControllerRef.current === controller) {
                    abortControllerRef.current = null;
                }
                setIsStreaming(false);
            }

            function applyEvent(event: TranscriptStreamEvent): void {
                switch (event.type) {
                    case 'transcript_partial':
                        // Append chunk to growing caption. See class
                        // header note on backend wire semantics.
                        setPartialTranscript((prev) => prev + event.text);
                        break;
                    case 'transcript_final':
                        setFinalTranscript(event.text);
                        break;
                    case 'error':
                        setError(event.message || event.code || 'Voice transcribe error.');
                        break;
                    default: {
                        // Exhaustiveness check — if a new event type is
                        // added to the union, the compiler flags this
                        // branch as unreachable.
                        const _exhaustive: never = event;
                        return _exhaustive;
                    }
                }
            }
        },
        [],
    );

    // Abort on unmount so a stream that's mid-flight when the parent
    // component unmounts does not keep the connection open.
    useEffect(() => {
        return () => {
            const ctrl = abortControllerRef.current;
            if (ctrl) {
                ctrl.abort();
                abortControllerRef.current = null;
            }
        };
    }, []);

    return {
        startTranscribe,
        stop,
        partialTranscript,
        finalTranscript,
        error,
        isStreaming,
    };
}
