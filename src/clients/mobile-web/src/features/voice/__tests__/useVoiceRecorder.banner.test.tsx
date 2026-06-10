// @vitest-environment jsdom
/**
 * useVoiceRecorder — Task 3 banner-paint-ordering tests
 * ─────────────────────────────────────────────────────
 * spec: voice-live-captions-banner-2026-06-10
 *
 * The "Your Shram sathi is trying to understand…" banner is driven by
 * status === 'processing'. handleAudioReady sets that state, then runs the
 * heavy preprocessAudio (AudioWorklet silence-trim + hashing + base64). If
 * the heavy work runs in the same tick as the setStatus commit, the browser
 * can't paint the banner until preprocessing finishes — so on long clips it
 * appears late.
 *
 * These tests lock the fix: handleAudioReady yields to the next paint
 * (requestAnimationFrame, macrotask fallback) AFTER committing
 * status='processing' and BEFORE preprocessAudio starts, so:
 *   1. The heavy preprocessor does NOT start synchronously with the call.
 *   2. By the time the preprocessor IS invoked, status is already 'processing'
 *      (the banner state is committed before the CPU work begins).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Keep the LiveCaption transcribe consumer inert; we exercise the batch path.
vi.mock('../../../infrastructure/ai/TranscribeStreamConsumer', () => ({
    TranscribeStreamConsumer: class {
        consume = vi.fn(() => (async function* () { /* no events */ })());
    },
}));

import { useVoiceRecorder } from '../useVoiceRecorder';
import type { VoiceParserPort, VoiceParseResult } from '../../../application/ports';
import type { AgriLogResponse, AudioData, CropProfile, FarmerProfile, FarmContext, InputMode } from '../../../types';
import type { LogScope } from '../../../domain/types/log.types';
import { VoicePreprocessor } from '../../../infrastructure/voice/VoicePreprocessor';

const FAKE_AGRI_LOG: AgriLogResponse = {
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    activityExpenses: [],
    disturbance: undefined,
    fullTranscript: 'काल पाणी दिले',
    summary: 'Watered yesterday',
    questionsForUser: [],
    fieldConfidences: {},
    confidence: 0.9,
    missingSegments: [],
    dayOutcome: 'WORK_RECORDED',
} as unknown as AgriLogResponse;

const FAKE_AUDIO_DATA: AudioData = {
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }),
    base64: 'AQIDBA==',
    mimeType: 'audio/webm',
    recordedAtUtc: '2026-06-10T08:12:35.000Z',
} as AudioData;

const FAKE_LOG_SCOPE = {
    selectedCropIds: ['grapes'],
    selectedPlotIds: ['plot-1'],
    mode: 'single',
    applyPolicy: 'broadcast',
} as unknown as LogScope;

const FAKE_FARMER = {
    activeOperatorId: 'op-1',
    operators: [{ id: 'op-1', name: 'Purvesh' }],
} as unknown as FarmerProfile;

const FAKE_CROPS = [{ id: 'grapes', name: 'Grapes', plots: [] } as unknown as CropProfile];

const FAKE_CONTEXT = {
    selection: [{ farmId: 'test-farm-1', cropId: 'grapes', selectedPlotIds: ['plot-1'] }],
} as unknown as FarmContext;

function buildBatchParser(): VoiceParserPort {
    return {
        parseInput: vi.fn(async (): Promise<VoiceParseResult> => ({
            success: true,
            data: FAKE_AGRI_LOG,
            provenance: { source: 'ai', timestamp: new Date().toISOString() },
        })),
        // No parseInputStream → forces the batch path (no live-caption stage).
    } as unknown as VoiceParserPort;
}

function buildHookProps(parser: VoiceParserPort, preprocessor: VoicePreprocessor) {
    return {
        currentLogContext: FAKE_CONTEXT,
        logScope: FAKE_LOG_SCOPE,
        hasActiveLogContext: true,
        crops: FAKE_CROPS,
        farmerProfile: FAKE_FARMER,
        setMode: vi.fn() as (m: InputMode) => void,
        parser,
        voicePreprocessor: preprocessor,
    };
}

describe('useVoiceRecorder banner paint ordering (Task 3, voice-live-captions-banner-2026-06-10)', () => {
    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
    });

    it('does NOT start the heavy preprocessor synchronously with handleAudioReady (yields to paint first)', async () => {
        const processBlobAsSingleBlob = vi.fn(async () => ({
            audioBlob: new Blob([new Uint8Array([9])], { type: 'audio/webm' }),
            mimeType: 'audio/webm',
            contentHash: 'h',
            metadata: {
                sessionId: 's', farmId: 'test-farm-1', totalSegments: 1,
                totalSpeechDurationMs: 1000, totalRawDurationMs: 1000, totalSilenceRemovedMs: 0,
                compressionRatio: 1, deviceTimestamp: new Date().toISOString(), clientTimezone: 'Asia/Kolkata',
            },
        }));
        const preprocessor = { processBlobAsSingleBlob } as unknown as VoicePreprocessor;
        const { result } = renderHook(() => useVoiceRecorder(buildHookProps(buildBatchParser(), preprocessor)));

        // Fire handleAudioReady but do NOT await — capture state right after the
        // synchronous portion + the immediate microtask flush completes.
        let pending: Promise<void>;
        act(() => {
            pending = result.current.handleAudioReady(FAKE_AUDIO_DATA);
        });

        // Allow microtasks to drain, but NOT a requestAnimationFrame tick.
        await Promise.resolve();
        await Promise.resolve();

        // Banner state is committed...
        expect(result.current.status).toBe('processing');
        // ...but the heavy preprocessor has NOT started yet — it waits for the
        // paint yield (rAF). If preprocessAudio ran in the same tick as
        // setStatus, this would already be 1 and the banner would paint late.
        expect(processBlobAsSingleBlob).not.toHaveBeenCalled();

        // Now let everything (rAF + the rest of the flow) run to completion.
        await act(async () => {
            await pending;
        });
        expect(processBlobAsSingleBlob).toHaveBeenCalledTimes(1);
    });

    it('the preprocessor only runs after a requestAnimationFrame tick (paint yield), and the batch path still hydrates buckets', async () => {
        // Record whether a requestAnimationFrame callback has fired by the time
        // the heavy preprocessor is invoked. The fix yields to rAF after
        // committing status='processing' and before preprocessing, so rAF MUST
        // have fired first.
        let rafFiredBeforePreprocess = false;
        let rafHasFired = false;
        const originalRaf = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
            return originalRaf(((t) => { rafHasFired = true; cb(t); }) as FrameRequestCallback);
        }) as typeof requestAnimationFrame;

        const processBlobAsSingleBlob = vi.fn(async () => {
            rafFiredBeforePreprocess = rafHasFired;
            return {
                audioBlob: new Blob([new Uint8Array([9])], { type: 'audio/webm' }),
                mimeType: 'audio/webm',
                contentHash: 'h',
                metadata: {
                    sessionId: 's', farmId: 'test-farm-1', totalSegments: 1,
                    totalSpeechDurationMs: 1000, totalRawDurationMs: 1000, totalSilenceRemovedMs: 0,
                    compressionRatio: 1, deviceTimestamp: new Date().toISOString(), clientTimezone: 'Asia/Kolkata',
                },
            };
        });
        const preprocessor = { processBlobAsSingleBlob } as unknown as VoicePreprocessor;

        try {
            const { result } = renderHook(() => useVoiceRecorder(buildHookProps(buildBatchParser(), preprocessor)));

            await act(async () => {
                await result.current.handleAudioReady(FAKE_AUDIO_DATA);
            });

            // The paint yield ran before the heavy work.
            expect(rafFiredBeforePreprocess).toBe(true);
            // Batch path still hydrates a draftLog → bucket-render contract intact.
            expect(result.current.draftLog).toEqual(FAKE_AGRI_LOG);
            expect(result.current.status).toBe('idle'); // settles back after parse
        } finally {
            globalThis.requestAnimationFrame = originalRaf;
        }
    });
});
