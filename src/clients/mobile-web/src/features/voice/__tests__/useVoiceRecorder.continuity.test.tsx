// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import 'fake-indexeddb/auto';

// Flag ON for this suite.
vi.mock('../../../app/featureFlags', async (orig) => {
    const actual = await orig<typeof import('../../../app/featureFlags')>();
    return { ...actual, FEATURE_FLAGS: { ...actual.FEATURE_FLAGS, voiceContinuity: true } };
});
// Device ASR unavailable (web) → forces the audio-only level.
vi.mock('../../../infrastructure/voice/DeviceSpeechRecognizer', () => ({
    DeviceSpeechRecognizer: class { transcribe = vi.fn(async () => ({ error: 'unavailable' as const })); },
}));
// Keep the live-caption transcribe consumer inert (batch path).
vi.mock('../../../infrastructure/ai/TranscribeStreamConsumer', () => ({
    TranscribeStreamConsumer: class { consume = vi.fn(() => (async function* () { /* none */ })()); },
}));

import { useVoiceRecorder } from '../useVoiceRecorder';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { PendingInterpretationStore } from '../continuity/PendingInterpretationStore';
import { ACCEPTED_NOTICE_PREF_KEY } from '../../consent/separation/coreConsentGate';
import { NOTICE_VERSION } from '../../consent/gate/consentNotice';
import type { VoiceParserPort, VoiceParseResult } from '../../../application/ports';
import type { AudioData, CropProfile, FarmerProfile, FarmContext, InputMode } from '../../../types';
import type { LogScope } from '../../../domain/types/log.types';
import { VoicePreprocessor } from '../../../infrastructure/voice/VoicePreprocessor';

const FAKE_AUDIO: AudioData = {
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }),
    base64: 'AQIDBA==', mimeType: 'audio/webm', recordedAtUtc: '2026-07-11T08:12:35.000Z',
} as AudioData;
const SCOPE = { selectedPlotIds: ['plot-1'], selectedCropIds: ['grapes'], mode: 'single', applyPolicy: 'broadcast' } as unknown as LogScope;
const FARMER = { activeOperatorId: 'op-1', operators: [{ id: 'op-1', name: 'Purvesh' }] } as unknown as FarmerProfile;
const CROPS = [{ id: 'grapes', name: 'Grapes', plots: [] } as unknown as CropProfile];
const CONTEXT = { selection: [{ farmId: 'farm-1', cropId: 'grapes', selectedPlotIds: ['plot-1'] }] } as unknown as FarmContext;

// Batch parser that always FAILS → drives the degraded ladder tail.
function failingParser(): VoiceParserPort {
    return { parseInput: vi.fn(async (): Promise<VoiceParseResult> => ({ success: false, error: 'AI down' })) } as unknown as VoiceParserPort;
}
function preprocessorOk(): VoicePreprocessor {
    // Return the PreprocessedAudioResult shape that `runBatchAudioPath` forwards
    // (useVoiceRecorder.ts): base64 + mimeType + the five metadata fields it passes
    // to processInput. This guarantees `preprocessed.base64` is defined so the
    // degraded audio-only path persists a truthy `audioBase64`.
    return { processBlobAsSingleBlob: vi.fn(async () => ({
        base64: 'AQIDBA==',
        mimeType: 'audio/webm',
        inputSpeechDurationMs: 1000,
        inputRawDurationMs: 1000,
        segmentMetadataJson: '{"sessionId":"s","farmId":"farm-1","totalSegments":1,"totalSpeechDurationMs":1000,"totalRawDurationMs":1000,"totalSilenceRemovedMs":0}',
        idempotencyKey: 'idem-1',
        requestPayloadHash: 'h',
    })) } as unknown as VoicePreprocessor;
}
function props(parser: VoiceParserPort, pre: VoicePreprocessor) {
    return { currentLogContext: CONTEXT, logScope: SCOPE, hasActiveLogContext: true, crops: CROPS, farmerProfile: FARMER, setMode: vi.fn() as (m: InputMode) => void, parser, voicePreprocessor: pre };
}

describe('useVoiceRecorder voice-continuity (flag ON)', () => {
    beforeEach(async () => {
        Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
        const db = getDatabase(); try { await db.delete(); } catch { /* ignore */ } await resetDatabase();
        // spec: dfes-companion-2026-07-11 (wave-4.3) — a farmer at the recorder has passed
        // the first-open gate; the gate stands in front of login and the recorder is behind
        // it. Recording that here is what makes this the ordinary case rather than an
        // impossible one. The refusal case is its own test below.
        await getDatabase().uiPrefs.put({ key: ACCEPTED_NOTICE_PREF_KEY, value: NOTICE_VERSION });
    });

    it('persists an audio-only pending capture when batch parse fails and device ASR is unavailable (streak preserved: no dead-end error)', async () => {
        const { result } = renderHook(() => useVoiceRecorder(props(failingParser(), preprocessorOk())));
        await act(async () => { await result.current.handleAudioReady(FAKE_AUDIO); });

        // No dead-end: status settled to idle, a durable capture was saved.
        expect(result.current.status).toBe('idle');
        expect(result.current.savedPendingCaptureId).toBeTruthy();
        expect(result.current.continuityLevel).toBe('audio-only');

        const pending = await PendingInterpretationStore.getInstance().listPending();
        expect(pending).toHaveLength(1);
        expect(pending[0].ladderLevel).toBe('audio-only');
        expect(pending[0].audioBase64).toBeTruthy();
        expect(pending[0].farmId).toBe('farm-1');
    });

    // spec: dfes-companion-2026-07-11 (wave-4.3) — NEVER STORE A VOICE CLIP BEFORE CORE
    // CONSENT, and never turn that refusal into a crash.
    it('discards the audio-only capture when core consent is not recorded, without a dead end', async () => {
        await getDatabase().uiPrefs.delete(ACCEPTED_NOTICE_PREF_KEY);

        const { result } = renderHook(() => useVoiceRecorder(props(failingParser(), preprocessorOk())));
        await act(async () => { await result.current.handleAudioReady(FAKE_AUDIO); });

        // WE lose the clip — he does not lose the app. Without a lawful basis we may not
        // hold his voice, and the honest outcome is a discard, not an exception thrown out
        // of the save path.
        const pending = await PendingInterpretationStore.getInstance().listPending();
        expect(pending).toHaveLength(0);
        expect(result.current.savedPendingCaptureId).toBeNull();
        expect(result.current.status).toBe('idle');
    });
});
