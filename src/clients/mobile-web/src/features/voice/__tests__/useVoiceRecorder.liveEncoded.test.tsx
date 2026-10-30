// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane V-1 (register F18) — a long recording the recorder already encoded while he spoke (`encodedLive`) is uploaded
 * exactly as recorded: the upload preparation does NOT decode, trim and re-encode it (that re-encode runs in real time,
 * a 10-minute wait for a 10-minute recording). Its hash is taken over the bytes sent, both durations are the recorded
 * length and the metadata says nothing was trimmed. Every other recording is prepared as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../../../infrastructure/ai/TranscribeStreamConsumer', () => ({
    TranscribeStreamConsumer: class {
        consume = vi.fn(() => (async function* () { /* no events */ })());
    },
}));

import { useVoiceRecorder } from '../useVoiceRecorder';
import { liveEncodedUpload } from '../liveEncodedUpload';
import type { VoiceParserPort, VoiceParseResult } from '../../../application/ports';
import type { AgriLogResponse, AudioData, CropProfile, FarmContext, FarmerProfile, InputMode } from '../../../types';
import type { LogScope } from '../../../domain/types/log.types';
import type { VoicePreprocessor } from '../../../infrastructure/voice/VoicePreprocessor';

const LONG: AudioData = {
    blob: new Blob([new Uint8Array([7, 7, 7, 7, 7])], { type: 'audio/webm' }),
    base64: 'BwcHBwc=',
    mimeType: 'audio/webm',
    recordedAtUtc: '2026-10-31T08:00:00.000Z',
    encodedLive: true,
    durationMs: 9 * 60_000 + 30_000,
};

const sha256Hex = async (blob: Blob): Promise<string> =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');

function hook(preprocessor: VoicePreprocessor, parseInput: VoiceParserPort['parseInput']) {
    return renderHook(() => useVoiceRecorder({
        currentLogContext: { selection: [{ farmId: 'farm-1', cropId: 'grapes', selectedPlotIds: ['plot-1'] }] } as unknown as FarmContext,
        logScope: { selectedCropIds: ['grapes'], selectedPlotIds: ['plot-1'], mode: 'single', applyPolicy: 'broadcast' } as unknown as LogScope,
        hasActiveLogContext: true,
        crops: [{ id: 'grapes', name: 'Grapes', plots: [] } as unknown as CropProfile],
        farmerProfile: { activeOperatorId: 'op-1', operators: [] } as unknown as FarmerProfile,
        setMode: vi.fn() as (m: InputMode) => void,
        parser: { parseInput } as unknown as VoiceParserPort,
        voicePreprocessor: preprocessor,
    }));
}

describe('lane V-1 — a live-encoded long recording is uploaded as recorded', () => {
    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
    });

    it('is never decoded and re-encoded; its own bytes, hash and length go to the parse', async () => {
        const processBlobAsSingleBlob = vi.fn();
        const parseInput = vi.fn(async (): Promise<VoiceParseResult> => ({
            success: true,
            data: { cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], missingSegments: [], summary: '', dayOutcome: 'WORK_RECORDED' } as unknown as AgriLogResponse,
        }));
        const { result } = hook({ processBlobAsSingleBlob } as unknown as VoicePreprocessor, parseInput);

        await act(async () => { await result.current.handleAudioReady(LONG); });

        expect(processBlobAsSingleBlob).not.toHaveBeenCalled();
        expect(parseInput).toHaveBeenCalledTimes(1);
        const sent = (parseInput.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
        expect(sent).toMatchObject({
            type: 'audio',
            data: LONG.base64,
            mimeType: 'audio/webm',
            inputSpeechDurationMs: LONG.durationMs,
            inputRawDurationMs: LONG.durationMs,
            requestPayloadHash: await sha256Hex(LONG.blob),
            recordedAtUtc: LONG.recordedAtUtc,
        });
        expect(typeof sent.idempotencyKey).toBe('string');
        expect(JSON.parse(sent.segmentMetadataJson as string)).toMatchObject({ totalSilenceRemovedMs: 0, totalSegments: 1, totalRawDurationMs: LONG.durationMs });
    });

    it('a recording the recorder did not encode live is prepared as before', async () => {
        const processBlobAsSingleBlob = vi.fn(async () => ({
            audioBlob: new Blob([new Uint8Array([1])], { type: 'audio/webm' }),
            mimeType: 'audio/webm',
            contentHash: 'h',
            metadata: { sessionId: 's', farmId: 'farm-1', totalSegments: 1, totalSpeechDurationMs: 1000, totalRawDurationMs: 1000, totalSilenceRemovedMs: 0, compressionRatio: 1, deviceTimestamp: '', clientTimezone: 'Asia/Kolkata' },
        }));
        const parseInput = vi.fn(async (): Promise<VoiceParseResult> => ({ success: false, error: 'x' }));
        const { result } = hook({ processBlobAsSingleBlob } as unknown as VoicePreprocessor, parseInput);
        const { encodedLive: _live, durationMs: _ms, ...short } = LONG;

        await act(async () => { await result.current.handleAudioReady(short); });

        expect(processBlobAsSingleBlob).toHaveBeenCalledTimes(1);
    });

    it('the same live recording always gets the same idempotency key (a retry is the same request)', async () => {
        const ids = { userId: 'op-1', farmId: 'farm-1', sessionId: 'session-1' };
        const a = await liveEncodedUpload(LONG, ids);
        const b = await liveEncodedUpload(LONG, ids);

        expect(a.result.idempotencyKey).toBe(b.result.idempotencyKey);
        expect(a.result.requestPayloadHash).toBe(await sha256Hex(LONG.blob));
        expect(a.metadata).toMatchObject({ totalSpeechDurationMs: LONG.durationMs, totalSilenceRemovedMs: 0, compressionRatio: 1 });
    });
});
