import { describe, it, expect } from 'vitest';
import { buildCanonicalVoiceInput } from '../canonicalVoiceInput';
import type { LogScope } from '../../../../domain/types/log.types';

const SCOPE: LogScope = {
    selectedPlotIds: ['plot-1'],
    selectedCropIds: ['grapes'],
    mode: 'single',
    applyPolicy: 'broadcast',
} as unknown as LogScope;

describe('buildCanonicalVoiceInput', () => {
    it('stamps a stable captureId and carries audio + scope verbatim', () => {
        const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
        const input = buildCanonicalVoiceInput({
            farmId: 'farm-1',
            logScope: SCOPE,
            recordedAtUtc: '2026-07-11T08:00:00.000Z',
            audioBase64: 'AQID',
            audioMimeType: 'audio/webm',
            audioBlob: blob,
        });
        expect(input.captureId).toMatch(/^[0-9a-f-]{16,}$/i);
        expect(input.farmId).toBe('farm-1');
        expect(input.audioBase64).toBe('AQID');
        expect(input.audioBlob).toBe(blob);
        expect(input.transcript).toBeNull();
        expect(input.deviceAsrUsed).toBe(false);
        expect(input.logScope).toEqual(SCOPE);
    });

    it('reuses a provided captureId (re-interpret path keeps identity)', () => {
        const input = buildCanonicalVoiceInput({
            captureId: 'fixed-id',
            farmId: 'farm-1',
            logScope: SCOPE,
            recordedAtUtc: '2026-07-11T08:00:00.000Z',
            transcript: 'काल पाणी दिले',
            deviceAsrUsed: true,
        });
        expect(input.captureId).toBe('fixed-id');
        expect(input.transcript).toBe('काल पाणी दिले');
        expect(input.deviceAsrUsed).toBe(true);
        expect(input.audioBase64).toBeNull();
    });
});
