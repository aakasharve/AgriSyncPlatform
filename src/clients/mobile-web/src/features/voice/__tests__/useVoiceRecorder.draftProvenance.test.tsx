// @vitest-environment jsdom
/**
 * PR #82 review B005 (spec: 2026-08-25-prod-cutover-waves) — a parse's provenance
 * is BOUND TO THE DRAFT it produced, so a draft that no parse produced (an edit
 * opened from Reflect or from today's activity list) can never inherit an
 * earlier, unrelated parse's `sourceAiJobId` at the labour door's बरोबर.
 *
 * The voice state's own `provenance` still holds the last parse after the draft
 * is replaced — that shared value is exactly what the labour door must NOT read.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../infrastructure/ai/TranscribeStreamConsumer', () => ({
    TranscribeStreamConsumer: class {
        consume = vi.fn(() => (async function* () { /* no events */ })());
    },
}));

import { useVoiceRecorder } from '../useVoiceRecorder';
import { draftProvenance } from '../draftProvenance';
import type { VoiceParserPort, VoiceParseResult } from '../../../application/ports';
import type { LogProvenance } from '../../../domain/ai/LogProvenance';
import type { AgriLogResponse, CropProfile, FarmerProfile, FarmContext, InputMode } from '../../../types';
import type { LogScope } from '../../../domain/types/log.types';
import type { VoicePreprocessor } from '../../../infrastructure/voice/VoicePreprocessor';

const parse = (names: string[]): AgriLogResponse => ({
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], inputs: [],
    machinery: [], activityExpenses: [], missingSegments: [], questionsForUser: [],
    labour: [{ id: 'l1', type: 'hired', count: names.length, workerNames: names }],
} as unknown as AgriLogResponse);

const PROV_A: LogProvenance = { source: 'ai', sourceAiJobId: 'aaaaaaaa-0000-4000-8000-000000000001', timestamp: '2026-10-16T05:00:00.000Z' };
const PROV_B: LogProvenance = { source: 'ai', sourceAiJobId: 'bbbbbbbb-0000-4000-8000-000000000002', timestamp: '2026-10-17T05:00:00.000Z' };

function parserReturning(...results: Array<{ data: AgriLogResponse; provenance: LogProvenance }>): VoiceParserPort {
    const queue = [...results];
    return {
        parseInput: vi.fn(async (): Promise<VoiceParseResult> => ({ success: true, ...queue.shift()! })),
    } as unknown as VoiceParserPort;
}

function hookProps(parser: VoiceParserPort) {
    return {
        currentLogContext: { selection: [{ farmId: 'farm-1', cropId: 'grapes', selectedPlotIds: ['plot-1'] }] } as unknown as FarmContext,
        logScope: { selectedCropIds: ['grapes'], selectedPlotIds: ['plot-1'], mode: 'single', applyPolicy: 'broadcast' } as unknown as LogScope,
        hasActiveLogContext: true,
        crops: [{ id: 'grapes', name: 'Grapes', plots: [] } as unknown as CropProfile],
        farmerProfile: { activeOperatorId: 'op-1', operators: [] } as unknown as FarmerProfile,
        setMode: vi.fn() as (m: InputMode) => void,
        parser,
        voicePreprocessor: {} as VoicePreprocessor,
    };
}

describe('a parse binds its provenance to the draft it produced (B005)', () => {
    it('the parsed draft carries its own provenance', async () => {
        const draftA = parse(['गणेश']);
        const { result } = renderHook(() => useVoiceRecorder(hookProps(parserReturning({ data: draftA, provenance: PROV_A }))));
        await act(async () => { await result.current.handleTextReady('गणेश आला'); });

        expect(result.current.draftLog).toBe(draftA);
        expect(draftProvenance(result.current.draftLog)).toEqual(PROV_A);
    });

    it('a draft put on screen by another path (an edit from Reflect) has NO provenance, though the voice state still holds the old one', async () => {
        const { result } = renderHook(() => useVoiceRecorder(hookProps(parserReturning({ data: parse(['गणेश']), provenance: PROV_A }))));
        await act(async () => { await result.current.handleTextReady('गणेश आला'); });

        const reflectEdit = parse(['शंकर']);
        act(() => { result.current.setDraftLog(reflectEdit); });

        expect(result.current.provenance).toEqual(PROV_A); // the stale value the labour door used to read
        expect(draftProvenance(result.current.draftLog)).toBeUndefined();
    });

    it('a second parse binds ITS provenance; the first draft keeps its own', async () => {
        const draftA = parse(['गणेश']);
        const draftB = parse(['शंकर']);
        // One parser for the hook's whole life (renderHook re-runs its callback on every render).
        const parser = parserReturning({ data: draftA, provenance: PROV_A }, { data: draftB, provenance: PROV_B });
        const { result } = renderHook(() => useVoiceRecorder(hookProps(parser)));
        await act(async () => { await result.current.handleTextReady('गणेश आला'); });
        await act(async () => { await result.current.handleTextReady('शंकर आला'); });

        expect(result.current.draftLog).toBe(draftB);
        expect(draftProvenance(draftB)).toEqual(PROV_B);
        expect(draftProvenance(draftA)).toEqual(PROV_A);
    });
});
