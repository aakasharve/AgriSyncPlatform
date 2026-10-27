// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — the recorder hands a parsed RECORDING to the
 * voice auto-save, and only a recording. Typed text keeps today's review form, and so does any parse the
 * auto-save declines (nothing he said is ever lost).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../../../infrastructure/ai/TranscribeStreamConsumer', () => ({
    TranscribeStreamConsumer: class {
        consume = vi.fn(() => (async function* () { /* no events */ })());
    },
}));

import { useVoiceRecorder } from '../useVoiceRecorder';
import type { VoiceDraftSink } from '../useVoiceRecorder.types';
import type { VoiceParserPort, VoiceParseResult } from '../../../application/ports';
import type { AgriLogResponse, AudioData, CropProfile, FarmerProfile, FarmContext, InputMode } from '../../../types';
import type { LogScope } from '../../../domain/types/log.types';
import type { VoicePreprocessor } from '../../../infrastructure/voice/VoicePreprocessor';

const PARSE = {
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], inputs: [], machinery: [],
    activityExpenses: [], missingSegments: [], questionsForUser: [],
    labour: [{ id: 'l1', type: 'HIRED', count: 4 }], fullTranscript: 'चार मजूर आले',
} as unknown as AgriLogResponse;

const AUDIO: AudioData = {
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }),
    base64: 'AQIDBA==',
    mimeType: 'audio/webm',
    recordedAtUtc: '2026-10-26T05:00:00.000Z',
} as AudioData;

const parser = (): VoiceParserPort => ({
    parseInput: vi.fn(async (): Promise<VoiceParseResult> => ({ success: true, data: PARSE, provenance: { source: 'ai', timestamp: 'T' } })),
} as unknown as VoiceParserPort);

// The heavy pre-processing falls back to the raw clip (as it does when the worklet is unavailable).
const preprocessor = { processBlobAsSingleBlob: vi.fn(async () => { throw new Error('no worklet in tests'); }) } as unknown as VoicePreprocessor;

const props = (onVoiceDraft: VoiceDraftSink | undefined, setMode = vi.fn() as (m: InputMode) => void) => ({
    currentLogContext: { selection: [{ farmId: 'farm-1', cropId: 'grapes', selectedPlotIds: ['plot-1'] }] } as unknown as FarmContext,
    logScope: { selectedCropIds: ['grapes'], selectedPlotIds: ['plot-1'], mode: 'single', applyPolicy: 'broadcast' } as unknown as LogScope,
    hasActiveLogContext: true,
    crops: [{ id: 'grapes', name: 'Grapes', plots: [] } as unknown as CropProfile],
    farmerProfile: { activeOperatorId: 'op-1', operators: [] } as unknown as FarmerProfile,
    setMode,
    parser: parser(),
    voicePreprocessor: preprocessor,
    onVoiceDraft,
});

describe('useVoiceRecorder → voice auto-save hand-off', () => {
    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    });

    it('a parsed RECORDING goes to the auto-save with the recording it came from; no review form opens', async () => {
        const sink = vi.fn<VoiceDraftSink>(async () => true);
        const setMode = vi.fn();
        const { result } = renderHook(() => useVoiceRecorder(props(sink, setMode)));
        await act(async () => { await result.current.handleAudioReady(AUDIO); });

        expect(sink).toHaveBeenCalledTimes(1);
        const [draft, , recording] = sink.mock.calls[0];
        expect(draft.fullTranscript).toBe('चार मजूर आले');
        expect(recording.recordedAtUtc).toBe(AUDIO.recordedAtUtc);
        expect(result.current.draftLog).toBeNull();
        expect(setMode).not.toHaveBeenCalledWith('manual');
    });

    it('a parse the auto-save DECLINES lands in today\'s review form, untouched', async () => {
        const sink = vi.fn<VoiceDraftSink>(async () => false);
        const setMode = vi.fn();
        const { result } = renderHook(() => useVoiceRecorder(props(sink, setMode)));
        await act(async () => { await result.current.handleAudioReady(AUDIO); });

        expect(sink).toHaveBeenCalledTimes(1);
        expect(result.current.draftLog?.fullTranscript).toBe('चार मजूर आले');
        expect(setMode).toHaveBeenCalledWith('manual');
        expect(result.current.status).toBe('idle');
    });

    it('TYPED text never reaches the auto-save: it keeps the review form', async () => {
        const sink = vi.fn<VoiceDraftSink>(async () => true);
        const { result } = renderHook(() => useVoiceRecorder(props(sink)));
        // A recording first, so a stale "last recording" cannot leak into the typed entry.
        await act(async () => { await result.current.handleAudioReady(AUDIO); });
        sink.mockClear();
        await act(async () => { await result.current.handleTextReady('चार मजूर आले'); });

        expect(sink).not.toHaveBeenCalled();
        expect(result.current.draftLog?.fullTranscript).toBe('चार मजूर आले');
    });

    it('with no auto-save wired, every parse goes to the review form as before (P11)', async () => {
        const { result } = renderHook(() => useVoiceRecorder(props(undefined)));
        await act(async () => { await result.current.handleAudioReady(AUDIO); });
        expect(result.current.draftLog?.fullTranscript).toBe('चार मजूर आले');
    });
});
