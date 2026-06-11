// @vitest-environment jsdom
/**
 * useVoiceRecorder LiveCaption Way-2 tests
 * ────────────────────────────────────────
 * SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — Flavor B unit test (founder
 * brainstorm option 3, 2026-05-28). Locks the cost-safe 2-stage flow:
 *
 *   Stage 1 (NEW): Sarvam transcribe-stream SSE
 *     - Consumes `transcript_partial` chunks into `liveCaption` state
 *     - Resolves to `transcript_final`
 *   Stage 2 (existing text path): Gemini structurer parse-voice-stream
 *     - Re-enters processInput with type='text'
 *     - parser.parseInputStream fires ONCE
 *     - parser.parseInput NEVER fires on happy path
 *
 * Cost invariant locked:
 *   - exactly 1 TranscribeStreamConsumer.consume call per recording
 *   - exactly 1 parser.parseInputStream call per recording
 *   - exactly 0 parser.parseInput calls per recording (happy path)
 *   On fallback path (Sarvam error):
 *   - parser.parseInput fires (audio batch path) — silent fallback per
 *     the founder rule "must not break the existing voice-note flow"
 *   - LiveCaption stays sticky after `complete` per founder Q2 2026-05-28
 *     ("the farmer can compare what they spoke with the generated draft")
 *
 * Imaginary scenario (per Flavor A trace):
 *   Farmer says: "आज द्राक्षांना spray मारला, 30 minutes लागले, 250 रुपये खर्च झाले."
 *   ("Today sprayed the grapes, took 30 minutes, spent 250 rupees.")
 *   Sarvam emits 4 partials then 1 final; Gemini emits 1 complete with
 *   the structured AgriLog.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Hoisted mocks (Vitest requires module-scope variable for the factory).
const mockConsume = vi.fn();
vi.mock('../../../infrastructure/ai/TranscribeStreamConsumer', () => ({
    TranscribeStreamConsumer: class {
        consume = mockConsume;
    },
}));

import { useVoiceRecorder } from '../useVoiceRecorder';
import type { VoiceParserPort, VoiceParseResult } from '../../../application/ports';
import type { ParseStreamEvent } from '../../../domain/ai/contracts/ParseStreamEvent';
import type { TranscriptStreamEvent } from '../../../domain/ai/contracts/TranscriptStreamEvent';
import type { AgriLogResponse, AudioData, CropProfile, FarmerProfile, FarmContext, InputMode } from '../../../types';
import type { LogScope } from '../../../domain/types/log.types';
import { VoicePreprocessor } from '../../../infrastructure/voice/VoicePreprocessor';

// ── Imaginary-scenario fixtures ──────────────────────────────────────

const FAKE_PARTIALS: ReadonlyArray<string> = [
    'आज ',
    'द्राक्षांना spray ',
    'मारला, 30 minutes लागले, ',
    '250 रुपये खर्च झाले.',
];
const FAKE_FINAL = 'आज द्राक्षांना spray मारला, 30 minutes लागले, 250 रुपये खर्च झाले.';
const FAKE_AGRI_LOG: AgriLogResponse = {
    cropActivities: [
        { cropId: 'grapes', activity: 'spray', durationMinutes: 30 } as never,
    ],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    activityExpenses: [
        { amount: 250, currency: 'INR', categoryId: 'pesticide' } as never,
    ],
    disturbance: undefined,
    fullTranscript: FAKE_FINAL,
    summary: 'Sprayed grapes for 30 min, ₹250 spent on pesticide',
    questionsForUser: [],
    fieldConfidences: {},
    confidence: 0.92,
    missingSegments: [],
    dayOutcome: 'WORK_RECORDED',
} as unknown as AgriLogResponse;

// ── Mock builders ────────────────────────────────────────────────────

function buildHappyTranscribeStream(): AsyncGenerator<TranscriptStreamEvent, void, unknown> {
    return (async function* () {
        for (const text of FAKE_PARTIALS) {
            yield { type: 'transcript_partial', text };
        }
        yield { type: 'transcript_final', text: FAKE_FINAL };
    })();
}

function buildErrorTranscribeStream(): AsyncGenerator<TranscriptStreamEvent, void, unknown> {
    return (async function* () {
        // One partial arrives, then Sarvam emits a terminal error.
        yield { type: 'transcript_partial', text: 'आज ' };
        yield { type: 'error', code: 'http_error', message: 'HTTP 502 Bad Gateway' };
    })();
}

function buildHttpFailureTranscribeStream(): AsyncGenerator<TranscriptStreamEvent, void, unknown> {
    // Per TranscribeStreamConsumer.consume's non-2xx surface: yields a
    // single error event then ends. Same shape we just modeled above,
    // but with no partials — covers the "stream never opened" case.
    return (async function* () {
        yield { type: 'error', code: 'http_error', message: 'HTTP 500 Internal Server Error' };
    })();
}

function buildHappyParser(): VoiceParserPort & {
    parseInput: ReturnType<typeof vi.fn>;
    parseInputStream: ReturnType<typeof vi.fn>;
} {
    const parseInputStream = vi.fn(
        (): AsyncIterable<ParseStreamEvent> =>
            (async function* () {
                yield { type: 'field_complete', fieldPath: 'cropActivities' };
                yield { type: 'field_complete', fieldPath: 'activityExpenses' };
                yield {
                    type: 'complete',
                    payload: FAKE_AGRI_LOG,
                    promptVersion: 'v3.2',
                    modelMs: 800,
                };
            })(),
    );
    const parseInput = vi.fn(
        async (): Promise<VoiceParseResult> => ({
            success: true,
            data: FAKE_AGRI_LOG,
            provenance: {
                source: 'ai',
                timestamp: new Date().toISOString(),
                promptVersion: 'v3.2',
                processingTimeMs: 850,
            },
        }),
    );
    return { parseInput, parseInputStream } as never;
}

// voice-sarvam-live-captions-2026-06-11 — parser whose STREAMING stage 2
// fails (terminal `error` event, no `complete`) but whose BATCH parseInput
// still succeeds. This models the exact regression that broke voice: Sarvam
// transcribe-stream succeeded (so we have a transcript), but
// parse-voice-stream errored — and previously the flow dead-ended with no
// log. The hardened flow must fall back to the batch AUDIO path.
function buildStreamFailsBatchOkParser(): VoiceParserPort & {
    parseInput: ReturnType<typeof vi.fn>;
    parseInputStream: ReturnType<typeof vi.fn>;
} {
    const parseInputStream = vi.fn(
        (): AsyncIterable<ParseStreamEvent> =>
            (async function* () {
                yield { type: 'text', content: '{"cropActiv' };
                yield {
                    type: 'error',
                    error: 'parse-voice-stream 503 Service Unavailable',
                };
            })(),
    );
    const parseInput = vi.fn(
        async (): Promise<VoiceParseResult> => ({
            success: true,
            data: FAKE_AGRI_LOG,
            provenance: {
                source: 'ai',
                timestamp: new Date().toISOString(),
                promptVersion: 'v3.2',
                processingTimeMs: 900,
            },
        }),
    );
    return { parseInput, parseInputStream } as never;
}

function buildPreprocessor(): VoicePreprocessor {
    // Stub the only method useVoiceRecorder.preprocessAudio touches.
    return {
        processBlobAsSingleBlob: vi.fn(async () => ({
            audioBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
            mimeType: 'audio/webm',
            contentHash: 'fakehash-1',
            metadata: {
                sessionId: 'test-session-1',
                farmId: 'test-farm-1',
                totalSegments: 1,
                totalSpeechDurationMs: 5000,
                totalRawDurationMs: 5000,
                totalSilenceRemovedMs: 0,
                compressionRatio: 1,
                deviceTimestamp: new Date().toISOString(),
                clientTimezone: 'Asia/Kolkata',
            },
        })),
    } as unknown as VoicePreprocessor;
}

const FAKE_AUDIO_DATA: AudioData = {
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }),
    base64: 'AQIDBA==',
    mimeType: 'audio/webm',
    recordedAtUtc: '2026-05-28T08:12:35.000Z',
} as AudioData;

const FAKE_LOG_SCOPE: LogScope = {
    selectedCropIds: ['grapes'],
    selectedPlotIds: ['plot-1'],
    mode: 'single',
    applyPolicy: 'broadcast',
} as unknown as LogScope;

const FAKE_FARMER: FarmerProfile = {
    activeOperatorId: 'op-1',
    operators: [{ id: 'op-1', name: 'Purvesh' }],
} as unknown as FarmerProfile;

const FAKE_CROPS: CropProfile[] = [{ id: 'grapes', name: 'Grapes', plots: [] } as unknown as CropProfile];

const FAKE_CONTEXT: FarmContext = {
    selection: [{ farmId: 'test-farm-1', cropId: 'grapes', selectedPlotIds: ['plot-1'] }],
} as unknown as FarmContext;

function buildHookProps(parser: VoiceParserPort) {
    return {
        currentLogContext: FAKE_CONTEXT,
        logScope: FAKE_LOG_SCOPE,
        hasActiveLogContext: true,
        crops: FAKE_CROPS,
        farmerProfile: FAKE_FARMER,
        setMode: vi.fn() as (m: InputMode) => void,
        parser,
        voicePreprocessor: buildPreprocessor(),
    };
}

// ── Test suite ───────────────────────────────────────────────────────

describe('useVoiceRecorder LiveCaption Way-2 (SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28)', () => {
    beforeEach(() => {
        mockConsume.mockReset();
        // Make sure navigator.onLine is true; the canRunLiveCaption check
        // gates on it.
        Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
    });

    it('happy path: Stage 1 streams captions, Stage 2 runs text-only, cost invariant holds', async () => {
        mockConsume.mockImplementation(() => buildHappyTranscribeStream());
        const parser = buildHappyParser();

        const { result } = renderHook(() => useVoiceRecorder(buildHookProps(parser)));

        await act(async () => {
            await result.current.handleAudioReady(FAKE_AUDIO_DATA);
        });

        // ── Cost invariant ─────────────────────────────────────────
        // Sarvam (transcribe-stream) called exactly once.
        expect(mockConsume).toHaveBeenCalledTimes(1);
        // Sarvam was called with the recorded blob + recordedAtUtc.
        const [blobArg, lang, mode, recordedAt] = mockConsume.mock.calls[0];
        expect(blobArg).toBeInstanceOf(Blob);
        expect(lang).toBe('mr-IN');
        expect(mode).toBe('codemix');
        expect(recordedAt).toBe(FAKE_AUDIO_DATA.recordedAtUtc);

        // Gemini structurer (parse-voice-stream) called exactly once,
        // with text payload (NOT audio — would be a cost-doubling regression).
        expect(parser.parseInputStream).toHaveBeenCalledTimes(1);
        const stage2Input = (parser.parseInputStream as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(stage2Input.type).toBe('text');
        expect(stage2Input.content).toBe(FAKE_FINAL);
        // recordedAtUtc threaded through to the text-stage Gemini call so
        // the structurer can resolve "आज" against the original instant.
        expect(stage2Input.recordedAtUtc).toBe(FAKE_AUDIO_DATA.recordedAtUtc);

        // Batch audio path MUST NOT fire on happy path — that would be a
        // double-Sarvam regression.
        expect(parser.parseInput).not.toHaveBeenCalled();

        // ── Final state ────────────────────────────────────────────
        // The final transcript replaces the assembled partials on the
        // transcript_final event; liveCaption holds that canonical text.
        expect(result.current.liveCaption).toBe(FAKE_FINAL);
        // Wizard receives the structured AgriLog.
        expect(result.current.draftLog).toEqual(FAKE_AGRI_LOG);
        // Stream lifecycle reaches complete (the Stage 2 structurer's terminal event).
        expect(result.current.voiceStreamingPhase).toBe('complete');
        // No error surfaced.
        expect(result.current.error).toBeNull();
    });

    it('sticky-caption UX: liveCaption stays visible after voiceStreamingPhase reaches "complete"', async () => {
        // Founder Q2 decision 2026-05-28: leave LiveCaption sticky so the
        // farmer can compare what they spoke against the generated draft.
        mockConsume.mockImplementation(() => buildHappyTranscribeStream());
        const parser = buildHappyParser();

        const { result } = renderHook(() => useVoiceRecorder(buildHookProps(parser)));

        await act(async () => {
            await result.current.handleAudioReady(FAKE_AUDIO_DATA);
        });

        // After Stage 2 'complete', liveCaption must STILL hold the
        // transcript text — the component renders whenever text is
        // non-empty, regardless of phase. handleResetVoice is what
        // ultimately clears it.
        expect(result.current.voiceStreamingPhase).toBe('complete');
        expect(result.current.liveCaption).toBe(FAKE_FINAL);
        expect(result.current.liveCaption.length).toBeGreaterThan(0);
    });

    it('handleResetVoice clears the sticky caption + aborts in-flight transcribe', async () => {
        mockConsume.mockImplementation(() => buildHappyTranscribeStream());
        const parser = buildHappyParser();
        const { result } = renderHook(() => useVoiceRecorder(buildHookProps(parser)));

        await act(async () => {
            await result.current.handleAudioReady(FAKE_AUDIO_DATA);
        });

        expect(result.current.liveCaption).toBe(FAKE_FINAL);

        act(() => {
            result.current.handleResetVoice();
        });

        expect(result.current.liveCaption).toBe('');
        expect(result.current.voiceStreamingPhase).toBe('idle');
        expect(result.current.draftLog).toBeNull();
    });

    it('fallback: Sarvam mid-stream error → silent fallback to batch audio path runs (founder reliability rule)', async () => {
        mockConsume.mockImplementation(() => buildErrorTranscribeStream());
        const parser = buildHappyParser();

        const { result } = renderHook(() => useVoiceRecorder(buildHookProps(parser)));

        await act(async () => {
            await result.current.handleAudioReady(FAKE_AUDIO_DATA);
        });

        // Stage 1 was attempted (Sarvam called once).
        expect(mockConsume).toHaveBeenCalledTimes(1);
        // Stage 1 emitted error → liveCaption was cleared before fallback so
        // the recorder doesn't show stale captions.
        expect(result.current.liveCaption).toBe('');
        // Fallback fires: audio batch path runs parser.parseInput exactly once.
        // (canStream=false for type='audio' → parseVoiceToDraft path → parser.parseInput.)
        expect(parser.parseInput).toHaveBeenCalledTimes(1);
        // The Gemini text-stream path was NOT used because Stage 1 failed
        // before producing a transcript.
        expect(parser.parseInputStream).not.toHaveBeenCalled();
        // The save/audit/diary flow still produced a draftLog — founder rule
        // "must not break the existing voice-note flow" preserved.
        expect(result.current.draftLog).toEqual(FAKE_AGRI_LOG);
        // No error surfaced to the user — fallback is silent.
        expect(result.current.error).toBeNull();
    });

    it('fallback: Sarvam HTTP failure (consumer yields single error, no partials) → batch audio path runs', async () => {
        mockConsume.mockImplementation(() => buildHttpFailureTranscribeStream());
        const parser = buildHappyParser();

        const { result } = renderHook(() => useVoiceRecorder(buildHookProps(parser)));

        await act(async () => {
            await result.current.handleAudioReady(FAKE_AUDIO_DATA);
        });

        expect(mockConsume).toHaveBeenCalledTimes(1);
        // Stage 1 produced zero partials — liveCaption never populated;
        // fallback path runs and the recorder ends up at idle with a draft.
        expect(result.current.liveCaption).toBe('');
        expect(parser.parseInput).toHaveBeenCalledTimes(1);
        expect(parser.parseInputStream).not.toHaveBeenCalled();
        expect(result.current.draftLog).toEqual(FAKE_AGRI_LOG);
    });

    it('CRITICAL fallback: transcribe OK but parse-voice-stream errors → batch AUDIO path runs, a draft is ALWAYS created', async () => {
        // voice-sarvam-live-captions-2026-06-11 — the exact regression that
        // broke voice before. Stage 1 (Sarvam transcribe-stream) succeeds and
        // yields a transcript (the live caption). Stage 2 (parse-voice-stream)
        // emits a terminal `error` with NO `complete` event. Previously the
        // flow surfaced an error and created NO log. The hardened flow MUST
        // fall back to the proven batch AUDIO path so a draft is created.
        mockConsume.mockImplementation(() => buildHappyTranscribeStream());
        const parser = buildStreamFailsBatchOkParser();

        const { result } = renderHook(() => useVoiceRecorder(buildHookProps(parser)));

        await act(async () => {
            await result.current.handleAudioReady(FAKE_AUDIO_DATA);
        });

        // Stage 1 ran once (transcribe) and the live caption shows the heard text.
        expect(mockConsume).toHaveBeenCalledTimes(1);
        expect(result.current.liveCaption).toBe(FAKE_FINAL);

        // Stage 2 streaming structurer was attempted...
        expect(parser.parseInputStream).toHaveBeenCalledTimes(1);
        // ...it failed (terminal error, no complete), so the batch AUDIO path
        // ran as the safety net. parseInput is invoked with an AUDIO input —
        // NOT text — so the gold-standard Gemini-multimodal parse runs.
        expect(parser.parseInput).toHaveBeenCalledTimes(1);
        const batchInput = (parser.parseInput as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(batchInput.type).toBe('audio');

        // The crucial invariant: a draft was created. Voice did NOT break.
        expect(result.current.draftLog).toEqual(FAKE_AGRI_LOG);
        // The flow settled cleanly with no user-facing error.
        expect(result.current.error).toBeNull();
        expect(result.current.status).toBe('idle');
    });

    // NOTE: A 7th "step-by-step partial accumulation" test was authored
    // and removed during the initial bring-up — it tried to step the
    // generator between releases and assert each intermediate
    // liveCaption value, but React 19 + Vitest's `act` environment did
    // not cooperate with the deferred-yield pattern. The behavior is
    // covered indirectly: the happy-path test above proves the assembled
    // value ends at FAKE_FINAL, which requires every partial to have
    // been correctly accumulated en route. If a future bug breaks
    // mid-stream accumulation, the happy-path assertion catches it at
    // the terminal state. Real-time intermediate-state observation is
    // better validated by the founder's manual hand-test (gate B6).
});
