// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — the voice auto-save hand-off.
 *
 * Founder 2026-09-02: a successful parse of a RECORDING is saved at once (no review form, no Save tap).
 * What these tests hold down:
 *   - ONE save per recording, whatever re-renders or re-entries happen (a second copy is a lie in his ledger);
 *   - the result screen (and with it "लक्षात ठेवलं") exists only AFTER the phone's write;
 *   - the save is stamped `autoSavedFromVoice`, and the clip is linked to the log it became;
 *   - what is NOT auto-saved keeps today's review form: the हजेरी door, an empty parse, a save that wrote nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVoiceAutoSave, type UseVoiceAutoSaveProps } from '../useVoiceAutoSave';
import type { AutoSaveOptions } from '../useLogCommands.types';
import type { AgriLogResponse, DailyLog } from '../../../types';

const parse = (over: Partial<AgriLogResponse> = {}): AgriLogResponse => ({
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], inputs: [], machinery: [],
    activityExpenses: [], missingSegments: [], questionsForUser: [],
    labour: [{ id: 'l1', type: 'HIRED', count: 4 }],
    fullTranscript: 'चार मजूर आले',
    ...over,
} as unknown as AgriLogResponse);

const savedLog = (id: string, transcript?: string) => ({ id, fullTranscript: transcript } as unknown as DailyLog);
const REC = { recordedAtUtc: '2026-10-26T05:00:00.000Z', clipId: 'clip-1' };

type SaveFn = UseVoiceAutoSaveProps['handleAutoSave'];

/** A save that writes `logs` and runs `onWritten` exactly where the real one does: after the write. */
const writes = (logs: DailyLog[]): ReturnType<typeof vi.fn<SaveFn>> =>
    vi.fn<SaveFn>(async (_d, _p, options?: AutoSaveOptions) => { await options?.onWritten?.(logs); return logs; });

const setup = (handleAutoSave: SaveFn, over: Partial<UseVoiceAutoSaveProps> = {}) => {
    const setStatus = vi.fn();
    const linkClip = vi.fn(async () => 'clip-1');
    const hook = renderHook((p: UseVoiceAutoSaveProps) => useVoiceAutoSave(p), {
        initialProps: { handleAutoSave, logIntent: null, setStatus, linkClip, ...over } as UseVoiceAutoSaveProps,
    });
    return { ...hook, setStatus, linkClip };
};

describe('useVoiceAutoSave — one save per recording', () => {
    it('saves a recording once, stamped as auto-saved from voice', async () => {
        const save = writes([savedLog('LOG-1', 'चार मजूर आले')]);
        const { result } = setup(save);
        let took = false;
        await act(async () => { took = await result.current.sink(parse(), undefined, REC); });
        expect(took).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0][2]).toMatchObject({ autoSavedFromVoice: true });
    });

    it('the SAME recording handed over again (re-render, re-entry) never writes a second copy', async () => {
        const save = writes([savedLog('LOG-1', 'x')]);
        const { result, rerender, setStatus } = setup(save);
        await act(async () => { await result.current.sink(parse(), undefined, REC); });
        rerender({ handleAutoSave: save, logIntent: null, setStatus, linkClip: vi.fn(async () => 'clip-1') });
        let again = false;
        await act(async () => { again = await result.current.sink(parse(), undefined, { ...REC }); });
        expect(again).toBe(true); // still owned by the result screen — no review form for a saved recording
        expect(save).toHaveBeenCalledTimes(1);
        expect(setStatus).toHaveBeenCalledWith('success');
    });

    it('two hand-overs at the same moment still make ONE save', async () => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        const save = vi.fn<SaveFn>(async (_d, _p, o) => { await gate; await o?.onWritten?.([savedLog('LOG-1')]); return [savedLog('LOG-1')]; });
        const { result } = setup(save);
        let both: boolean[] = [];
        await act(async () => {
            const a = result.current.sink(parse(), undefined, REC);
            const b = result.current.sink(parse(), undefined, REC);
            release();
            both = await Promise.all([a, b]);
        });
        expect(both).toEqual([true, true]);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('a NEW recording is a new save', async () => {
        const save = writes([savedLog('LOG-1')]);
        const { result } = setup(save);
        await act(async () => { await result.current.sink(parse(), undefined, REC); });
        await act(async () => { await result.current.sink(parse(), undefined, { recordedAtUtc: '2026-10-26T06:00:00.000Z', clipId: 'clip-2' }); });
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('a save that wrote NOTHING hands the parse back (review form) and may be tried again', async () => {
        const save = vi.fn<SaveFn>(async () => null);
        const { result } = setup(save);
        let took = true;
        await act(async () => { took = await result.current.sink(parse(), undefined, REC); });
        expect(took).toBe(false);
        expect(result.current.voiceResult).toBeNull();
        await act(async () => { await result.current.sink(parse(), undefined, REC); });
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('a save that throws hands the parse back too (nothing lost)', async () => {
        const save = vi.fn<SaveFn>(async () => { throw new Error('disk'); });
        const { result } = setup(save);
        let took = true;
        await act(async () => { took = await result.current.sink(parse(), undefined, REC); });
        expect(took).toBe(false);
    });
});

describe('useVoiceAutoSave — the saved claim only after the write', () => {
    it('no result screen while the write is in flight; it appears with the written logs, linked to the clip', async () => {
        let finishWrite!: () => void;
        const writeDone = new Promise<void>(r => { finishWrite = r; });
        const logs = [savedLog('LOG-A'), savedLog('LOG-B', 'दोन तास पाणी दिलं')];
        const save = vi.fn<SaveFn>(async (_d, _p, o) => { await writeDone; await o?.onWritten?.(logs); return logs; });
        const { result, linkClip } = setup(save);

        let pending!: Promise<boolean>;
        act(() => { pending = result.current.sink(parse({ unclearSegments: [{ rawText: ' काहीतरी ' }] } as never), undefined, REC); });
        expect(result.current.voiceResult).toBeNull(); // nothing claimed before the phone has it

        await act(async () => { finishWrite(); await pending; });
        expect(result.current.voiceResult).toMatchObject({ logIds: ['LOG-A', 'LOG-B'], clipId: 'clip-1', unclear: ['काहीतरी'] });
        // The clip is linked to the log that carries his words (one record holds the day's facts).
        expect(linkClip).toHaveBeenCalledWith(REC, 'LOG-B');
    });

    it('a clip this phone does not hold links nothing and the screen still appears (no ▶, never a guess)', async () => {
        const save = writes([savedLog('LOG-1', 'x')]);
        const { result } = setup(save, { linkClip: vi.fn(async () => null) });
        await act(async () => { await result.current.sink(parse(), undefined, REC); });
        expect(result.current.voiceResult).toMatchObject({ logIds: ['LOG-1'], clipId: null });
    });

    it('a new recording gets a new key (the ring replays only for a new recording)', async () => {
        const save = writes([savedLog('LOG-1')]);
        const { result } = setup(save);
        await act(async () => { await result.current.sink(parse(), undefined, REC); });
        const first = result.current.voiceResult?.key;
        await act(async () => { await result.current.sink(parse(), undefined, { recordedAtUtc: '2026-10-26T07:00:00.000Z' }); });
        expect(result.current.voiceResult?.key).not.toBe(first);
    });

    it('clearVoiceResult drops it (मागे / आणखी सांगा), so it cannot stand in for a later save', async () => {
        const save = writes([savedLog('LOG-1')]);
        const { result } = setup(save);
        await act(async () => { await result.current.sink(parse(), undefined, REC); });
        act(() => result.current.clearVoiceResult());
        expect(result.current.voiceResult).toBeNull();
    });
});

describe('useVoiceAutoSave — what is NOT auto-saved keeps today\'s review form', () => {
    it('the हजेरी door (labour intent) is never auto-saved', async () => {
        const save = writes([savedLog('LOG-1')]);
        const { result } = setup(save, { logIntent: 'labour' });
        let took = true;
        await act(async () => { took = await result.current.sink(parse(), undefined, REC); });
        expect(took).toBe(false);
        expect(save).not.toHaveBeenCalled();
    });

    it('a parse with nothing understood is never auto-saved (no empty record written for him)', async () => {
        const save = writes([savedLog('LOG-1')]);
        const { result } = setup(save);
        let took = true;
        await act(async () => { took = await result.current.sink(parse({ labour: [] }), undefined, REC); });
        expect(took).toBe(false);
        await act(async () => { took = await result.current.sink(parse({ dayOutcome: 'IRRELEVANT_INPUT' } as never), undefined, { ...REC, clipId: 'c9' }); });
        expect(took).toBe(false);
        expect(save).not.toHaveBeenCalled();
    });

    it('a parse MISSING a part\'s list never throws: missing reads as empty (no English "Could not process log…")', async () => {
        const save = writes([savedLog('LOG-1')]);
        const { result } = setup(save);
        const without = (over: Record<string, unknown>) => {
            const draft = parse(over as Partial<AgriLogResponse>) as unknown as Record<string, unknown>;
            delete draft.cropActivities;
            delete draft.inputs;
            return draft as unknown as AgriLogResponse;
        };
        let took = false;
        // Something else understood → still saved at once.
        await act(async () => { took = await result.current.sink(without({}), undefined, REC); });
        expect(took).toBe(true);
        // Nothing understood and lists missing → today's review form, not a crash.
        await act(async () => { took = await result.current.sink(without({ labour: undefined }), undefined, { ...REC, clipId: 'c2' }); });
        expect(took).toBe(false);
        expect(save).toHaveBeenCalledTimes(1);
    });
});

describe('useVoiceAutoSave — round 2', () => {
    const FARM = 'a1a1a1a1-0000-4000-8000-0000000000f1';

    it('sends closure.submitted ONCE (method voice, the log with his words, parts filled) after the phone write', async () => {
        const emitClosure = vi.fn();
        const save = writes([savedLog('LOG-A'), savedLog('LOG-B', 'चार मजूर आले')]);
        const { result } = setup(save, { farmId: FARM, emitClosure });
        const spoke = { ...REC, recordedAtUtc: new Date(Date.now() - 4000).toISOString() };
        await act(async () => { await result.current.sink(parse({ irrigation: [{ id: 'w', durationHours: 2 }] } as never), undefined, spoke); });
        expect(emitClosure).toHaveBeenCalledTimes(1);
        const payload = emitClosure.mock.calls[0][0];
        expect(payload).toMatchObject({ farmId: FARM, logId: 'LOG-B', method: 'voice', fields_used: 2 });
        expect(payload.durationMs).toBeGreaterThanOrEqual(4000);
        // The same recording handed over again: no second save, so no second event.
        await act(async () => { await result.current.sink(parse(), undefined, { ...spoke }); });
        expect(save).toHaveBeenCalledTimes(1);
        expect(emitClosure).toHaveBeenCalledTimes(1);
    });

    it('sends nothing when nothing was written, or when the farm is not known (as the review form did)', async () => {
        const emitClosure = vi.fn();
        const { result } = setup(vi.fn<SaveFn>(async () => null), { farmId: FARM, emitClosure });
        await act(async () => { await result.current.sink(parse(), undefined, REC); });
        const noFarm = setup(writes([savedLog('LOG-1', 'x')]), { farmId: null, emitClosure });
        await act(async () => { await noFarm.result.current.sink(parse(), undefined, REC); });
        expect(emitClosure).not.toHaveBeenCalled();
    });

    it('a parse that would MOVE the save to a plot the AI suggested is never auto-saved: he chooses on the review form', async () => {
        const save = writes([savedLog('LOG-1')]);
        const { result } = setup(save);
        let took = true;
        await act(async () => { took = await result.current.sink(parse({ suggestedContext: { cropId: 'c2', plotId: 'p9' } } as never), undefined, REC); });
        expect(took).toBe(false);
        expect(save).not.toHaveBeenCalled();
    });
});
