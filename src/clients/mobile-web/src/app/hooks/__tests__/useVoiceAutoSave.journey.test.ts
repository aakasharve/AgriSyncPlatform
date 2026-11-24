// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 1) — the auto-save SAYS its real moments to the v2 step list (`voiceJourneySignal`):
 * understood → plot checked → written. Display only: what is saved, and when, is exactly what `useVoiceAutoSave.test.ts`
 * holds down; nothing here may change it. 'written' comes only after the phone's durable write (`onWritten`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// A signal that throws outright (it never should: it catches its own errors) must still never reach the save.
const signal = vi.hoisted(() => ({ throwing: false }));
vi.mock('../../../infrastructure/voice/voiceJourneySignal', async orig => {
    const real = await orig<typeof import('../../../infrastructure/voice/voiceJourneySignal')>();
    return {
        ...real,
        noteVoiceJourney: (...args: Parameters<typeof real.noteVoiceJourney>) => {
            if (signal.throwing) throw new Error('signal down');
            real.noteVoiceJourney(...args);
        },
    };
});
import { useVoiceAutoSave, type UseVoiceAutoSaveProps } from '../useVoiceAutoSave';
import type { AutoSaveOptions } from '../useLogCommands.types';
import type { AgriLogResponse, DailyLog } from '../../../types';
import {
    noteVoiceJourney, readVoiceJourney, resetVoiceJourneyForTests, subscribeVoiceJourney, type VoiceJourneySnapshot,
} from '../../../infrastructure/voice/voiceJourneySignal';

const parse = (over: Partial<AgriLogResponse> = {}): AgriLogResponse => ({
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], inputs: [], machinery: [],
    activityExpenses: [], missingSegments: [], questionsForUser: [],
    labour: [{ id: 'l1', type: 'HIRED', count: 4 }],
    fullTranscript: 'चार मजूर आले',
    ...over,
} as unknown as AgriLogResponse);

const savedLog = (id: string) => ({ id, fullTranscript: 'x' } as unknown as DailyLog);
const REC = { recordedAtUtc: '2026-11-23T05:00:00.000Z', clipId: 'clip-1' };
type SaveFn = UseVoiceAutoSaveProps['handleAutoSave'];

/** Every snapshot the signal published, in order (what the step list would see). */
let seen: VoiceJourneySnapshot[] = [];
const kinds = (): string[] => {
    const out: string[] = [];
    let prev: VoiceJourneySnapshot | null = null;
    for (const s of seen) {
        if (s.draft && !prev?.draft) out.push('understood');
        if (s.place && s.place !== prev?.place) out.push(`place:${s.place}`);
        if (s.writtenAt && !prev?.writtenAt) out.push('written');
        prev = s;
    }
    return out;
};

const setup = (handleAutoSave: SaveFn, over: Partial<UseVoiceAutoSaveProps> = {}) => renderHook((p: UseVoiceAutoSaveProps) => useVoiceAutoSave(p), {
    initialProps: { handleAutoSave, logIntent: null, setStatus: vi.fn(), linkClip: vi.fn(async () => 'clip-1'), ...over } as UseVoiceAutoSaveProps,
});

beforeEach(() => {
    resetVoiceJourneyForTests();
    seen = [];
    noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: 4000 });
    subscribeVoiceJourney(() => { const s = readVoiceJourney(); if (s) seen.push(s); });
});
afterEach(() => resetVoiceJourneyForTests());

describe('useVoiceAutoSave — the real moments, said to the step list', () => {
    it('a savable draft: understood → plot same → written, with the written ids, written only after onWritten', async () => {
        const order: string[] = [];
        const save = vi.fn<SaveFn>(async (_d, _p, o?: AutoSaveOptions) => {
            order.push(`save-start:${readVoiceJourney()?.writtenAt ? 'written' : 'not-yet'}`);
            await o?.onWritten?.([savedLog('LOG-1'), savedLog('LOG-2')]);
            order.push(`after-onWritten:${readVoiceJourney()?.writtenAt ? 'written' : 'not-yet'}`);
            return [savedLog('LOG-1'), savedLog('LOG-2')];
        });
        const { result } = setup(save);
        const draft = parse();
        await act(async () => { await result.current.sink(draft, undefined, REC); });
        expect(kinds()).toEqual(['understood', 'place:same', 'written']);
        expect(readVoiceJourney()?.draft).toBe(draft);
        expect(readVoiceJourney()?.logIds).toEqual(['LOG-1', 'LOG-2']);
        expect(order).toEqual(['save-start:not-yet', 'after-onWritten:written']);
    });

    it('the हजेरी door (labour intent) says nothing', async () => {
        const save = vi.fn<SaveFn>();
        const { result } = setup(save, { logIntent: 'labour' });
        await act(async () => { await result.current.sink(parse(), undefined, REC); });
        expect(kinds()).toEqual([]);
        expect(seen).toEqual([]);
    });

    it('nothing understood: understood + plot unclear, never written', async () => {
        const save = vi.fn<SaveFn>();
        const { result } = setup(save);
        await act(async () => { await result.current.sink(parse({ labour: [], cropActivities: [] }), undefined, REC); });
        expect(kinds()).toEqual(['understood', 'place:unclear']);
        expect(save).not.toHaveBeenCalled();
    });

    it('a parse that would move the plot: plot otherPlot, never written', async () => {
        const save = vi.fn<SaveFn>();
        const { result } = setup(save);
        await act(async () => {
            await result.current.sink(parse({ suggestedContext: { cropId: 'grape', plotId: 'g2' } } as Partial<AgriLogResponse>), undefined, REC);
        });
        expect(kinds()).toEqual(['understood', 'place:otherPlot']);
        expect(save).not.toHaveBeenCalled();
    });

    it('a save that wrote nothing (null) says no written', async () => {
        const save = vi.fn<SaveFn>(async () => null);
        const { result } = setup(save);
        let took = true;
        await act(async () => { took = await result.current.sink(parse(), undefined, REC); });
        expect(took).toBe(false);
        expect(kinds()).toEqual(['understood', 'place:same']);
    });

    it('a subscriber that throws changes nothing the sink does', async () => {
        subscribeVoiceJourney(() => { throw new Error('broken screen'); });
        const save = vi.fn<SaveFn>(async (_d, _p, o?: AutoSaveOptions) => { await o?.onWritten?.([savedLog('LOG-1')]); return [savedLog('LOG-1')]; });
        const { result } = setup(save);
        let took = false;
        await act(async () => { took = await result.current.sink(parse(), undefined, REC); });
        expect(took).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
        expect(result.current.voiceResult?.logIds).toEqual(['LOG-1']);
    });

    it('a signal that throws outright never reaches the save', async () => {
        signal.throwing = true;
        try {
            const save = vi.fn<SaveFn>(async (_d, _p, o?: AutoSaveOptions) => { await o?.onWritten?.([savedLog('LOG-1')]); return [savedLog('LOG-1')]; });
            const { result } = setup(save);
            let took = false;
            await act(async () => { took = await result.current.sink(parse(), undefined, REC); });
            expect(took).toBe(true);
            expect(save).toHaveBeenCalledTimes(1);
            expect(result.current.voiceResult?.logIds).toEqual(['LOG-1']);
        } finally {
            signal.throwing = false;
        }
    });

    it('saveChecked (the "तपासा आणि जतन करा" save) says nothing', async () => {
        const save = vi.fn<SaveFn>(async (_d, _p, o?: AutoSaveOptions) => { await o?.onWritten?.([savedLog('LOG-1')]); return [savedLog('LOG-1')]; });
        const { result } = setup(save);
        await act(async () => {
            await result.current.saveChecked(parse(), undefined, { scope: { selectedCropIds: ['grape'], selectedPlotIds: ['g1'], mode: 'single', applyPolicy: 'broadcast' } });
        });
        expect(seen).toEqual([]);
    });
});
