// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1d (founder Q-A, 27 Nov: "Save after बरोबर").
 * The FIRST record of a farm on this phone is NOT auto-saved: the voice auto-save hands its parse back through the existing
 * "तपासा आणि जतन करा" path (`bindDraftDecline`, reason `firstRecord`), and it is saved only when he presses "बरोबर" there
 * (`saveChecked`, the same save). Every later record saves at once, exactly as today (D-44). Over a real phone database
 * (fake-indexeddb) with the real gate:
 *   - the first record writes no record and queues no command until "बरोबर";
 *   - "बरोबर" saves it once (the same recording handed over again never makes a second copy);
 *   - leaving before "बरोबर" saves nothing, and the recording stays on the phone, not linked to any record — the आवाज नोंदी
 *     page lists it (it reads every row of `voiceClips`); the next recording is still asked for "बरोबर";
 *   - the second record auto-saves as today; so does an installed phone whose farm already has records (P11);
 *   - a caller that gives no gate (every other one) keeps today's auto-save.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVoiceAutoSave, type UseVoiceAutoSaveProps } from '../useVoiceAutoSave';
import type { AutoSaveOptions } from '../useLogCommands.types';
import type { AgriLogResponse, DailyLog, LogScope } from '../../../types';
import type { VoiceClipCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { draftDecline } from '../../../features/voice/draftFacts';
import { isFirstRecordOnPhone } from '../../../features/onboarding/firstRun/firstRecordGate';

const FARM = 'farm-1';
const WHOLE_FARM: LogScope = { selectedCropIds: ['FARM_GLOBAL'], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
const parse = (): AgriLogResponse => ({
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [{ id: 'a1', title: 'फवारणी' }], irrigation: [], inputs: [], machinery: [],
    activityExpenses: [], missingSegments: [], questionsForUser: [], labour: [], fullTranscript: 'आज बागेत फवारणी केली',
} as unknown as AgriLogResponse);
const rec = (clipId: string) => ({ recordedAtUtc: '2026-11-28T05:00:00.000Z', clipId });
const clipRow = (id: string): VoiceClipCacheRecord => ({
    id, farmId: FARM, plotId: null, recordedAtUtc: '2026-11-28T05:00:00.000Z', durationMs: 4000, mimeType: 'audio/webm', sizeBytes: 3,
    ciphertext: new Uint8Array([1]).buffer, iv: new Uint8Array([1]), wrappedDekId: 'dek', status: 'parsed',
    retentionPolicy: 'processing_30d', expiresAtUtc: '2026-12-28T00:00:00.000Z', createdAt: 'T', updatedAt: 'T',
} as unknown as VoiceClipCacheRecord);

type SaveFn = UseVoiceAutoSaveProps['handleAutoSave'];
/** Stands in for the real save: writes the record to the phone (as `confirmAndSave` does), then runs `onWritten`. */
const writesToPhone = (id: string) => vi.fn<SaveFn>(async (_d, _p, options?: AutoSaveOptions) => {
    const log = { id, date: '2026-11-28', meta: { farmId: FARM } } as unknown as DailyLog;
    await getDatabase().logs.put({ id, schemaVersion: 1, date: log.date, log, isDeleted: 0 });
    await options?.onWritten?.([log]);
    return [log];
});

const setup = (handleAutoSave: SaveFn, over: Partial<UseVoiceAutoSaveProps> = {}) => {
    const setStatus = vi.fn();
    const linkClip = vi.fn(async () => 'clip-1');
    const emitClosure = vi.fn();
    const hook = renderHook((p: UseVoiceAutoSaveProps) => useVoiceAutoSave(p), {
        initialProps: { handleAutoSave, logIntent: null, setStatus, linkClip, archiveIdOf: async () => undefined, emitClosure, farmId: FARM, isFirstRecord: isFirstRecordOnPhone, ...over } as UseVoiceAutoSaveProps,
    });
    return { ...hook, setStatus, linkClip, emitClosure };
};

beforeEach(async () => {
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
});

describe('R1-g 1d — the FIRST record of the farm waits for "बरोबर"', () => {
    it('handed back to "तपासा आणि जतन करा": no record written, no command queued, no clip linked, no result screen', async () => {
        await getDatabase().voiceClips.put(clipRow('clip-first'));
        const save = writesToPhone('LOG-1');
        const { result, linkClip, emitClosure, setStatus } = setup(save);
        const draft = parse();
        let took = true;
        await act(async () => { took = await result.current.sink(draft, undefined, rec('clip-first')); });
        expect(took).toBe(false);
        expect(save).not.toHaveBeenCalled();
        expect(linkClip).not.toHaveBeenCalled();
        expect(emitClosure).not.toHaveBeenCalled();
        expect(setStatus).not.toHaveBeenCalled();
        expect(result.current.voiceResult).toBeNull();
        expect(draftDecline(draft)).toEqual({ reason: 'firstRecord', recording: rec('clip-first') });
        expect(await getDatabase().logs.count()).toBe(0);
        expect(await getDatabase().mutationQueue.count()).toBe(0);
    });

    it('"बरोबर" saves it once, through the same save; handed over again it is never written twice', async () => {
        const save = writesToPhone('LOG-1');
        const { result } = setup(save);
        const draft = parse();
        await act(async () => { await result.current.sink(draft, undefined, rec('clip-first')); });
        let written: DailyLog[] | null = null;
        await act(async () => { written = await result.current.saveChecked(draft, undefined, { scope: WHOLE_FARM, recording: rec('clip-first') }); });
        expect(written).toHaveLength(1);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0][2]).toMatchObject({ autoSavedFromVoice: true, scope: WHOLE_FARM });
        expect(result.current.voiceResult?.logIds).toEqual(['LOG-1']);
        // The same recording handed over again (a re-entry): the result screen keeps it, no second copy.
        let again = false;
        await act(async () => { again = await result.current.sink(parse(), undefined, rec('clip-first')); });
        expect(again).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('leaving before "बरोबर": nothing saved, the recording stays on the phone unlinked (the आवाज नोंदी list), and the next one is asked again', async () => {
        await getDatabase().voiceClips.put(clipRow('clip-first'));
        const save = writesToPhone('LOG-1');
        const { result, unmount } = setup(save);
        await act(async () => { await result.current.sink(parse(), undefined, rec('clip-first')); });
        unmount(); // he closes the screen / the app: the parse on screen is gone with it
        const clips = await getDatabase().voiceClips.toArray();
        expect(clips.map(c => c.id)).toEqual(['clip-first']);
        expect(clips[0].dailyLogId).toBeUndefined();
        expect(await getDatabase().logs.count()).toBe(0);
        expect(await getDatabase().mutationQueue.count()).toBe(0);
        // Still the farm's first: the next recording is asked for "बरोबर" too.
        const again = setup(save);
        let took = true;
        await act(async () => { took = await again.result.current.sink(parse(), undefined, rec('clip-second')); });
        expect(took).toBe(false);
        expect(save).not.toHaveBeenCalled();
    });

    it('the SECOND record auto-saves at once, as today', async () => {
        const save = writesToPhone('LOG-1');
        const { result } = setup(save);
        const first = parse();
        await act(async () => { await result.current.sink(first, undefined, rec('clip-first')); });
        await act(async () => { await result.current.saveChecked(first, undefined, { scope: WHOLE_FARM, recording: rec('clip-first') }); });
        const second = writesToPhone('LOG-2');
        const next = setup(second);
        let took = false;
        await act(async () => { took = await next.result.current.sink(parse(), undefined, rec('clip-second-x')); });
        expect(took).toBe(true);
        expect(second).toHaveBeenCalledTimes(1);
        expect(second.mock.calls[0][2]).toMatchObject({ autoSavedFromVoice: true });
    });

    it('P11: an installed phone whose farm already has records (and no mark) auto-saves as today', async () => {
        await getDatabase().logs.put({ id: 'old-1', schemaVersion: 1, date: '2026-11-01', isDeleted: 0, log: { id: 'old-1', date: '2026-11-01', meta: { farmId: FARM } } as unknown as DailyLog });
        const save = writesToPhone('LOG-1');
        const { result } = setup(save);
        let took = false;
        await act(async () => { took = await result.current.sink(parse(), undefined, rec('clip-first')); });
        expect(took).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('a caller that gives no gate keeps today\'s auto-save, even on a farm with no record', async () => {
        const save = writesToPhone('LOG-1');
        const { result } = setup(save, { isFirstRecord: undefined });
        let took = false;
        await act(async () => { took = await result.current.sink(parse(), undefined, rec('clip-first')); });
        expect(took).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('a gate that cannot answer fails to today\'s auto-save (nothing is held on a guess)', async () => {
        const save = writesToPhone('LOG-1');
        const { result } = setup(save, { isFirstRecord: async () => { throw new Error('read failed'); } });
        let took = false;
        await act(async () => { took = await result.current.sink(parse(), undefined, rec('clip-first')); });
        expect(took).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
    });
});
