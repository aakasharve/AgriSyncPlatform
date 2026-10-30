// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane AI-2 (register F71) — while a "बदला" correction is spoken, the parse request carries the entry being changed
 * (`correctionOf`, inside the context it already sends), so "इथरेल 350 नाही, 400 मिली" is understood as a dose change,
 * not a new note. Every other parse is sent exactly as before. The same typed words for two different entries are two
 * different requests (the server answers a repeated key from its store).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ parseTextLog: vi.fn(), parseVoiceLog: vi.fn() }));

vi.mock('../BackendAiClient.helpers', async importOriginal => ({
    ...(await importOriginal<typeof import('../BackendAiClient.helpers')>()),
    resolveFarmIdFromCache: async () => 'farm-1',
    resolveUserIdFromSession: () => 'user-1',
}));
vi.mock('../../api/AgriSyncClient', () => ({
    agriSyncClient: { parseTextLog: h.parseTextLog, parseVoiceLog: h.parseVoiceLog },
}));

import { BackendAiClient } from '../BackendAiClient';
import { setCorrectionParseContext } from '../correctionParseContext';
import type { CropProfile, FarmerProfile, LogScope } from '../../../types';

const SCOPE: LogScope = { selectedCropIds: ['grapes'], selectedPlotIds: ['p1'], mode: 'single', applyPolicy: 'broadcast' };
const PROFILE = { activeOperatorId: 'user-1', operators: [], motors: [], waterResources: [], machineries: [] } as unknown as FarmerProfile;
const ETHREL = { inputs: [{ productName: 'Ethrel', rawProductName: 'इथरेल', method: 'Spray', quantity: 350, unit: 'ml' }] };
const OTHER = { inputs: [{ productName: 'Bavistin', method: 'Spray', quantity: 200, unit: 'g' }] };
const ANSWER = { parsedLog: { summary: '', dayOutcome: 'WORK_RECORDED', inputs: [], cropActivities: [], irrigation: [], labour: [], machinery: [], activityExpenses: [], missingSegments: [] }, confidence: 0.9 };

const typed = (text: string) => new BackendAiClient().parseInput({ type: 'text', content: text }, SCOPE, [] as CropProfile[], PROFILE);
const sentContext = (call = 0) => h.parseTextLog.mock.calls[call][1] as Record<string, unknown>;
const sentOptions = (call = 0) => h.parseTextLog.mock.calls[call][3] as { idempotencyKey: string; requestPayloadHash: string };

describe('lane AI-2 — the correction context on the parse request', () => {
    let online: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        h.parseTextLog.mockReset().mockResolvedValue(ANSWER);
        h.parseVoiceLog.mockReset().mockResolvedValue(ANSWER);
    });
    afterEach(() => { online.mockRestore(); setCorrectionParseContext(() => null); });

    it('a correction sends the entry it changes as correctionOf', async () => {
        setCorrectionParseContext(() => ETHREL);

        await typed('इथरेल 350 नाही, 400 मिली');

        expect(sentContext().correctionOf).toEqual(ETHREL);
        // ...inside the context the parse always sent (nothing else moved).
        expect(sentContext()).toHaveProperty('availableCrops');
        expect(sentContext()).toHaveProperty('farmContext');
    });

    it('a recorded correction carries it too', async () => {
        setCorrectionParseContext(() => ETHREL);
        // The clip's local bookkeeping (Dexie) is not what this test is about.
        const proto = BackendAiClient.prototype as unknown as Record<string, () => Promise<unknown>>;
        const keep = vi.spyOn(proto, 'persistProcessingVoiceClip').mockResolvedValue(undefined);
        const material = vi.spyOn(proto, 'resolveVoiceUploadMaterial').mockResolvedValue({
            audioBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), mimeType: 'audio/webm', idempotencyKey: 'k', requestPayloadHash: 'h',
        });

        await new BackendAiClient().parseInput({ type: 'audio', data: 'AQID', mimeType: 'audio/webm' }, SCOPE, [] as CropProfile[], PROFILE);
        keep.mockRestore();
        material.mockRestore();

        expect((h.parseVoiceLog.mock.calls[0][2] as Record<string, unknown>).correctionOf).toEqual(ETHREL);
    });

    it('every other parse is sent exactly as before: no correctionOf key at all', async () => {
        await typed('आज इथरेल 400 मिली फवारणी केली');

        expect(sentContext()).not.toHaveProperty('correctionOf');
    });

    it('a supplier that throws never blocks the parse: it goes as a normal one', async () => {
        setCorrectionParseContext(() => { throw new Error('history not ready'); });

        const result = await typed('इथरेल 350 नाही, 400 मिली');

        expect(result.success).toBe(true);
        expect(sentContext()).not.toHaveProperty('correctionOf');
    });

    it('the same words for two different entries are two different requests; a day\'s words keep their old key', async () => {
        setCorrectionParseContext(() => ETHREL);
        await typed('350 नाही, 400');
        setCorrectionParseContext(() => OTHER);
        await typed('350 नाही, 400');
        setCorrectionParseContext(() => null);
        await typed('350 नाही, 400');
        await typed('350 नाही, 400');

        const keys = [0, 1, 2, 3].map(i => sentOptions(i).idempotencyKey);
        expect(new Set(keys.slice(0, 3)).size).toBe(3);
        expect(keys[3]).toBe(keys[2]); // a normal parse is keyed on its words alone, as before
        expect(sentOptions(0).requestPayloadHash).not.toBe(sentOptions(2).requestPayloadHash);
    });
});
