import { describe, it, expect } from 'vitest';
import { decideLadderLevel, buildPendingFromCanonical } from '../voiceContinuityLadder';
import { buildCanonicalVoiceInput } from '../canonicalVoiceInput';
import type { LogScope } from '../../../../domain/types/log.types';

const SCOPE: LogScope = { selectedPlotIds: ['plot-1'], selectedCropIds: ['grapes'], mode: 'single', applyPolicy: 'broadcast' } as unknown as LogScope;

describe('decideLadderLevel', () => {
    it('L1 streaming when online and structured parse succeeded via the stream', () => {
        expect(decideLadderLevel({ online: true, structuredParseSucceeded: true, usedStream: true, deviceAsrAvailable: false, transcript: 'x' })).toBe('streaming');
    });
    it('L2 batch when online and structured parse succeeded via batch fallback', () => {
        expect(decideLadderLevel({ online: true, structuredParseSucceeded: true, usedStream: false, deviceAsrAvailable: false, transcript: 'x' })).toBe('batch');
    });
    it('L3 transcript-only when structuring failed but a transcript exists', () => {
        expect(decideLadderLevel({ online: false, structuredParseSucceeded: false, usedStream: false, deviceAsrAvailable: true, transcript: 'काल पाणी दिले' })).toBe('transcript-only');
    });
    it('L4 audio-only when structuring failed and there is no transcript at all', () => {
        expect(decideLadderLevel({ online: false, structuredParseSucceeded: false, usedStream: false, deviceAsrAvailable: false, transcript: null })).toBe('audio-only');
    });
});

describe('buildPendingFromCanonical', () => {
    it('serialises a transcript-only capture without audio', () => {
        const input = buildCanonicalVoiceInput({
            captureId: 'cap-1', farmId: 'farm-1', logScope: SCOPE,
            recordedAtUtc: '2026-07-11T08:00:00.000Z', transcript: 'काल पाणी दिले', deviceAsrUsed: true,
        });
        const rec = buildPendingFromCanonical(input, 'transcript-only', 1234);
        expect(rec).toMatchObject({
            captureId: 'cap-1', farmId: 'farm-1', status: 'pending',
            ladderLevel: 'transcript-only', transcript: 'काल पाणी दिले',
            audioBase64: null, createdAtUtc: 1234, attempts: 0, lastAttemptAtUtc: null,
        });
        expect(JSON.parse(rec.logScopeJson)).toEqual(SCOPE);
    });
    it('serialises an audio-only capture carrying base64 audio', () => {
        const input = buildCanonicalVoiceInput({
            captureId: 'cap-2', farmId: 'farm-1', logScope: SCOPE,
            recordedAtUtc: '2026-07-11T08:00:00.000Z', audioBase64: 'AQID', audioMimeType: 'audio/webm',
        });
        const rec = buildPendingFromCanonical(input, 'audio-only', 999);
        expect(rec.ladderLevel).toBe('audio-only');
        expect(rec.audioBase64).toBe('AQID');
        expect(rec.audioMimeType).toBe('audio/webm');
        expect(rec.transcript).toBeNull();
    });
});
