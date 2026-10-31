// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF) — the save plumbing under the five new homes:
 *   - D-60: an entry spoken for a PAST day lands on that day (the log's own `date`, sent as `logDate`); the time it was
 *     recorded is untouched; the day rides the parse from the ONE mic (`withSpeakPurpose`) to the auto-save;
 *   - D-58: the auto-save says WHY it handed a parse back (nothing understood / another plot / not written), and a parse
 *     he checked is saved through the same save, on the place he chose (never Sathi's suggestion), with its recording;
 *   - D-59: saved from आवाज नोंदी, the log tab is left as it was (no result screen, no status change).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { createFromVoice, confirmAndSave, enqueueLogsForSync, findSaved } = vi.hoisted(() => ({
    createFromVoice: vi.fn(),
    confirmAndSave: vi.fn(),
    enqueueLogsForSync: vi.fn(),
    findSaved: vi.fn(),
}));
vi.mock('../../providers/DataSourceProvider', () => ({ useDataSource: () => ({ dataSource: { logs: {} } }) }));
vi.mock('../../../features/logs/services/logSyncMutationService', () => ({ enqueueLogsForSync }));
vi.mock('../../../i18n/LanguageContext', () => ({ useLanguage: () => ({ language: 'mr', setLanguage: () => { }, t: (k: string) => k }) }));
vi.mock('../../../application/services/LogCommandService', () => ({
    LogCommandServiceImpl: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.createFromVoice = createFromVoice;
        this.confirmAndSave = confirmAndSave;
        this.findSaved = findSaved;
    }),
}));

import { useLogCommands } from '../useLogCommands';
import { useVoiceAutoSave, type UseVoiceAutoSaveProps } from '../useVoiceAutoSave';
import type { AutoSaveOptions } from '../useLogCommands.types';
import type { AgriLogResponse, DailyLog, FarmerProfile, LogScope } from '../../../types';
import { onDay } from '../../helpers/onDay';
import { bindDraftDay, draftDay, draftDecline } from '../../../features/voice/draftFacts';
import { withSpeakPurpose } from '../../../core/speak/speakFlow';
import { requestSpeak, resetSpeakStoreForTests } from '../../../core/speak/speakStore';
import { isAfterFarmToday } from '../../../core/domain/services/farmDay';
import { logger } from '../../../infrastructure/observability/Logger';

const P1: LogScope = { selectedCropIds: ['c1'], selectedPlotIds: ['p1'], mode: 'single', applyPolicy: 'broadcast' };
const P2: LogScope = { selectedCropIds: ['c1'], selectedPlotIds: ['p2'], mode: 'single', applyPolicy: 'broadcast' };
const makeLog = (id: string): DailyLog => ({
    id, date: '2026-10-31',
    context: { selection: [{ cropId: 'c1', selectedPlotIds: ['p1'] }] },
    cropActivities: [{ id: 'a', title: 'खुरपणी' }], irrigation: [], inputs: [], machinery: [], plannedTasks: [], labour: [],
    observations: [{ id: 'o', textRaw: 'पानं पिवळी', dateKey: '2026-10-31' }],
    meta: { createdAtISO: '2026-10-31T06:00:00.000Z' },
} as unknown as DailyLog);
const parse = (over: Partial<AgriLogResponse> = {}) => ({ summary: 'x', fullTranscript: 'खुरपणी केली', cropActivities: [{ id: 'a', title: 'खुरपणी' }], ...over } as unknown as AgriLogResponse);

const commandProps = (setStatus = vi.fn(), setLastSavedLogIds = vi.fn()) => ({
    hasActiveLogContext: true, logScope: P1, setLogScope: vi.fn(), crops: [],
    farmerProfile: { operators: [], activeOperatorId: 'op1' } as unknown as FarmerProfile,
    history: [], plannedTasks: [], isDemoMode: false, setHistory: vi.fn(), setPlannedTasks: vi.fn(), setToast: vi.fn(),
    setError: vi.fn(), setDraftLog: vi.fn(), setRecordingSegment: vi.fn(), setMode: vi.fn(), setMainView: vi.fn(), setStatus,
    setLastSavedLogSummary: vi.fn(), setLastSavedLogIds, logIntent: null as null, setCurrentRoute: vi.fn(), setLastLabourLogIds: vi.fn(),
});

beforeEach(() => {
    vi.clearAllMocks();
    resetSpeakStoreForTests();
    createFromVoice.mockImplementation(async () => [makeLog('V1')]);
    confirmAndSave.mockResolvedValue(undefined);
    enqueueLogsForSync.mockResolvedValue({ queuedLogIds: ['V1'], skippedLogIds: [] });
    findSaved.mockResolvedValue([]);
});

describe('D-60 — a past day', () => {
    it('onDay moves only the DAY (and the notes filed under it); the time it was recorded is untouched', () => {
        const moved = onDay(makeLog('x'), '2026-10-28');
        expect(moved.date).toBe('2026-10-28');
        expect(moved.observations?.[0].dateKey).toBe('2026-10-28');
        expect(moved.meta?.createdAtISO).toBe('2026-10-31T06:00:00.000Z');
        expect(() => onDay(makeLog('x'), 'not-a-day')).toThrow(); // fix 1 (H1): refused plainly, never quietly kept
    });

    it('handleAutoSave with dateKey writes and sends the log ON that day', async () => {
        const { result } = renderHook(() => useLogCommands(commandProps()));
        await act(async () => { await result.current.handleAutoSave(parse(), undefined, { autoSavedFromVoice: true, dateKey: '2026-10-28' }); });
        expect((confirmAndSave.mock.calls[0][0] as DailyLog[])[0].date).toBe('2026-10-28');
        expect((enqueueLogsForSync.mock.calls[0][0] as DailyLog[])[0].date).toBe('2026-10-28');
    });

    it('the ONE mic carries the day he chose onto the parse, and the auto-save saves on it', async () => {
        requestSpeak({ purpose: 'addToDay', context: { date: '2026-10-28' }, returnTo: { route: 'main', mainView: 'reflect' } });
        const sink = vi.fn(async (d: AgriLogResponse) => { expect(draftDay(d)).toBe('2026-10-28'); return true; });
        const draft = parse();
        await withSpeakPurpose(sink, { setStatus: vi.fn() })(draft, undefined, { recordedAtUtc: 'T' });
        expect(sink).toHaveBeenCalledTimes(1);
        const save = vi.fn<UseVoiceAutoSaveProps['handleAutoSave']>(async (_d, _p, o?: AutoSaveOptions) => { await o?.onWritten?.([makeLog('V1')]); return [makeLog('V1')]; });
        const { result } = renderHook(() => useVoiceAutoSave({ handleAutoSave: save, logIntent: null, setStatus: vi.fn(), linkClip: vi.fn(async () => null), archiveIdOf: vi.fn(async () => undefined) }));
        await act(async () => { await result.current.sink(draft, undefined, { recordedAtUtc: 'T2' }); });
        expect(save.mock.calls[0][2]).toMatchObject({ dateKey: '2026-10-28' });
    });

    it('a day from no request is no day (today, as always)', () => {
        expect(draftDay(bindDraftDay(parse(), undefined))).toBeUndefined();
    });
});

describe('D-58 — why a parse was handed back, and saving it after a check', () => {
    const autoSave = (handleAutoSave: UseVoiceAutoSaveProps['handleAutoSave']) =>
        renderHook(() => useVoiceAutoSave({ handleAutoSave, logIntent: null, setStatus: vi.fn(), linkClip: vi.fn(async () => 'clip-1'), archiveIdOf: vi.fn(async () => 'arch-1') }));

    it.each([
        ['nothing understood', 'unclear', parse({ cropActivities: [] })],
        ['another plot suggested', 'otherPlot', parse({ suggestedContext: { cropId: 'c1', plotId: 'p2' } } as Partial<AgriLogResponse>)],
    ] as const)('%s → handed back, marked "%s", with its recording', async (_label, reason, draft) => {
        const save = vi.fn(async () => [makeLog('V1')]);
        const { result } = autoSave(save);
        let took = true;
        await act(async () => { took = await result.current.sink(draft, undefined, { recordedAtUtc: 'T', clipId: 'clip-9' }); });
        expect(took).toBe(false);
        expect(save).not.toHaveBeenCalled();
        expect(draftDecline(draft)).toEqual({ reason, recording: { recordedAtUtc: 'T', clipId: 'clip-9' } });
    });

    it('the phone could not write it → handed back as "notWritten"', async () => {
        const { result } = autoSave(vi.fn(async () => null));
        const draft = parse();
        await act(async () => { await result.current.sink(draft, undefined, { recordedAtUtc: 'T' }); });
        expect(draftDecline(draft)?.reason).toBe('notWritten');
    });

    it('saveChecked: the place he chose (never the suggestion), the day, the recording named and linked, the result screen', async () => {
        const save = vi.fn<UseVoiceAutoSaveProps['handleAutoSave']>(async (_d, _p, o?: AutoSaveOptions) => { await o?.onWritten?.([makeLog('V1')]); return [makeLog('V1')]; });
        const { result } = autoSave(save);
        const draft = parse({ suggestedContext: { cropId: 'c1', plotId: 'p2' } } as Partial<AgriLogResponse>);
        await act(async () => { await result.current.saveChecked(draft, undefined, { scope: P2, dateKey: '2026-10-29', recording: { recordedAtUtc: 'T', clipId: 'clip-9' } }); });
        const [sent, , options] = save.mock.calls[0];
        expect(sent.suggestedContext).toBeUndefined();
        expect(options).toMatchObject({ autoSavedFromVoice: true, scope: P2, dateKey: '2026-10-29', voiceClipId: 'arch-1' });
        expect(result.current.voiceResult).toMatchObject({ logIds: ['V1'], clipId: 'clip-1' });
    });

    it('handleAutoSave with a chosen scope saves there even with no log-tab place, and ignores a suggestion', async () => {
        const setLogScope = vi.fn();
        const { result } = renderHook(() => useLogCommands({ ...commandProps(), hasActiveLogContext: false, setLogScope }));
        await act(async () => { await result.current.handleAutoSave(parse({ suggestedContext: { cropId: 'c9', plotId: 'p9' } } as Partial<AgriLogResponse>), undefined, { scope: P2 }); });
        expect(createFromVoice.mock.calls[0][1]).toEqual(P2);
        expect(setLogScope).not.toHaveBeenCalled();
    });
});

describe('D-59 — saved from आवाज नोंदी', () => {
    it('stayOnScreen: written and sent, but the log tab is left as it was (no status, no result screen)', async () => {
        const setStatus = vi.fn();
        const setLastSavedLogIds = vi.fn();
        const { result } = renderHook(() => useLogCommands(commandProps(setStatus, setLastSavedLogIds)));
        let saved: DailyLog[] | null = null;
        await act(async () => { saved = await result.current.handleAutoSave(parse(), undefined, { scope: P1, dateKey: '2026-10-30', stayOnScreen: true }); });
        expect(saved).toHaveLength(1);
        expect(confirmAndSave).toHaveBeenCalledTimes(1);
        expect(enqueueLogsForSync).toHaveBeenCalledTimes(1);
        expect(setStatus).not.toHaveBeenCalled();
        expect(setLastSavedLogIds).not.toHaveBeenCalled();
    });
});

// ─── Lane OF fix pass 1 ───────────────────────────────────────────────────────────────────────────────────────
describe('fix 1 — H1: the write path itself refuses a day after today', () => {
    it('handleAutoSave with a FUTURE day writes nothing and sends nothing (whatever screen asked)', async () => {
        const { result } = renderHook(() => useLogCommands(commandProps()));
        let saved: DailyLog[] | null = [];
        await act(async () => { saved = await result.current.handleAutoSave(parse(), undefined, { autoSavedFromVoice: true, dateKey: '2099-01-01' }); });
        expect(saved).toBeNull();
        expect(confirmAndSave).not.toHaveBeenCalled();
        expect(enqueueLogsForSync).not.toHaveBeenCalled();
    });

    it('the one rule: today and earlier days are fine, a later one is not', () => {
        expect(isAfterFarmToday('2026-10-31', '2026-10-31')).toBe(false);
        expect(isAfterFarmToday('2026-10-30', '2026-10-31')).toBe(false);
        expect(isAfterFarmToday('2026-11-01', '2026-10-31')).toBe(true);
        expect(() => onDay(makeLog('x'), '2099-01-01')).toThrow();
    });
});

describe('fix 1 — M1: one recording never makes two logs', () => {
    it('the same once-key gives the same log ids, and a second save of it writes nothing and returns the logs already on the phone', async () => {
        const gens: Array<{ generate: () => string }> = [];
        createFromVoice.mockImplementation(async (...args: unknown[]) => { gens.push(args[6] as { generate: () => string }); return [makeLog('V1')]; });
        findSaved.mockResolvedValueOnce([]).mockResolvedValueOnce([makeLog('V1')]);
        const { result } = renderHook(() => useLogCommands(commandProps()));
        let first: DailyLog[] | null = null;
        let second: DailyLog[] | null = null;
        await act(async () => { first = await result.current.handleAutoSave(parse(), undefined, { onceKey: 'job:7', stayOnScreen: true }); });
        await act(async () => { second = await result.current.handleAutoSave(parse(), undefined, { onceKey: 'job:7', stayOnScreen: true }); });
        expect(gens).toHaveLength(2);
        expect([gens[0].generate(), gens[0].generate()]).toEqual([gens[1].generate(), gens[1].generate()]);
        expect(confirmAndSave).toHaveBeenCalledTimes(1);
        expect(enqueueLogsForSync).toHaveBeenCalledTimes(1);
        expect(first).toHaveLength(1);
        expect(second).toEqual([makeLog('V1')]);
    });

    it('fix 2 (N1): on the "already saved" path the recording-link step runs again (a missing clip link is made), nothing is written', async () => {
        createFromVoice.mockResolvedValue([makeLog('V1')]);
        findSaved.mockResolvedValueOnce([makeLog('V1')]);
        const onWritten = vi.fn(async () => { throw new Error('clip store'); });
        const { result } = renderHook(() => useLogCommands(commandProps()));
        let got: DailyLog[] | null = null;
        await act(async () => { got = await result.current.handleAutoSave(parse(), undefined, { onceKey: 'job:8', stayOnScreen: true, onWritten }); });
        expect(onWritten).toHaveBeenCalledWith([makeLog('V1')]);
        expect(got).toEqual([makeLog('V1')]); // a failed link never turns "already saved" into "not saved"
        expect(confirmAndSave).not.toHaveBeenCalled();
    });
});

describe('fix 1 — M2: saved from आवाज नोंदी, a record that will not reach the server is never just "saved"', () => {
    it('stayOnScreen says the same as the log tab: the phone claim, then that it will not go into the farm records', async () => {
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: ['V1'] });
        const setToast = vi.fn();
        const { result } = renderHook(() => useLogCommands({ ...commandProps(), setToast }));
        await act(async () => { await result.current.handleAutoSave(parse(), undefined, { scope: P1, stayOnScreen: true }); });
        expect(setToast).toHaveBeenCalledTimes(1);
        const { message } = setToast.mock.calls[0][0] as { message: string };
        expect(message).toContain('शेतनोंदीत जाणार नाहीत');
        expect(message).not.toContain('जतन झालं');
    });
});

describe('fix 1 — L4: a recording that cannot be named or linked leaves a trace', () => {
    it('saveChecked: archive-id and clip-link failures are logged, and the save still happens', async () => {
        const warn = vi.spyOn(logger, 'warn');
        const save = vi.fn<UseVoiceAutoSaveProps['handleAutoSave']>(async (_d, _p, o?: AutoSaveOptions) => { await o?.onWritten?.([makeLog('V1')]); return [makeLog('V1')]; });
        const { result } = renderHook(() => useVoiceAutoSave({
            handleAutoSave: save, logIntent: null, setStatus: vi.fn(),
            linkClip: vi.fn(async () => { throw new Error('clip store'); }), archiveIdOf: vi.fn(async () => { throw new Error('no archive id'); }),
        }));
        await act(async () => { await result.current.saveChecked(parse(), undefined, { scope: P1, recording: { recordedAtUtc: 'T', clipId: 'c' } }); });
        expect(save).toHaveBeenCalledTimes(1);
        const said = warn.mock.calls.map(c => String(c[0])).join(' | ');
        expect(said).toMatch(/archive/i);
        expect(said).toMatch(/link/i);
        warn.mockRestore();
    });
});
