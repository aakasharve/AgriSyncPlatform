// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — `handleAutoSave`, the voice path's ONE save.
 *
 *   - Only the voice auto-save stamps `autoSavedFromVoice` (so the server keeps the log unconfirmed) and starts
 *     the phone's own copy as a DRAFT; a typed/hand-filled save never carries it.
 *   - "Written" means the phone's durable write resolved: `onWritten` (which puts the result screen up) runs
 *     after `confirmAndSave`, never before, and never when the write failed.
 *   - A failed write claims nothing: no 'success', no saved ids, and the optimistic copy is taken back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLogCommands } from '../useLogCommands';
import { LogVerificationStatus, type AgriLogResponse, type DailyLog, type FarmerProfile } from '../../../types';

const { createFromManual, createFromVoice, confirmAndSave, updateLog, enqueueLogsForSync } = vi.hoisted(() => ({
    createFromManual: vi.fn(),
    createFromVoice: vi.fn(),
    confirmAndSave: vi.fn(),
    updateLog: vi.fn(),
    enqueueLogsForSync: vi.fn(),
}));

vi.mock('../../providers/DataSourceProvider', () => ({ useDataSource: () => ({ dataSource: { logs: {} } }) }));
vi.mock('../../../features/logs/services/logSyncMutationService', () => ({ enqueueLogsForSync }));
vi.mock('../../../i18n/LanguageContext', () => ({ useLanguage: () => ({ language: 'mr', setLanguage: () => { }, t: (k: string) => k }) }));
vi.mock('../../../application/services/LogCommandService', () => ({
    LogCommandServiceImpl: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.createFromManual = createFromManual;
        this.createFromVoice = createFromVoice;
        this.confirmAndSave = confirmAndSave;
        this.updateLog = updateLog;
    }),
}));

const makeLog = (id: string): DailyLog => ({
    id,
    date: '2026-10-26',
    context: { selection: [{ cropId: 'c1', selectedPlotIds: ['p1'] }] },
    cropActivities: [], irrigation: [], inputs: [], machinery: [], plannedTasks: [],
    labour: [{ id: `lab-${id}`, count: 4 }],
    // What LogFactory stamps on an owner's log today: "approved" at creation.
    verification: { status: LogVerificationStatus.APPROVED, required: false },
} as unknown as DailyLog);

const parse = { summary: 'x', labour: [{ id: 'l', count: 4 }] } as unknown as AgriLogResponse;

describe('useLogCommands.handleAutoSave — the voice auto-save', () => {
    const setStatus = vi.fn();
    const setHistory = vi.fn();
    const setLastSavedLogIds = vi.fn();
    const setToast = vi.fn();

    const props = () => ({
        hasActiveLogContext: true,
        logScope: { selectedCropIds: ['c1'], selectedPlotIds: ['p1'], mode: 'single' as const, applyPolicy: 'broadcast' as const },
        setLogScope: vi.fn(),
        crops: [],
        farmerProfile: { operators: [], activeOperatorId: 'op1' } as unknown as FarmerProfile,
        history: [],
        plannedTasks: [],
        isDemoMode: false,
        setHistory,
        setPlannedTasks: vi.fn(),
        setToast,
        setError: vi.fn(),
        setDraftLog: vi.fn(),
        setRecordingSegment: vi.fn(),
        setMode: vi.fn(),
        setMainView: vi.fn(),
        setStatus,
        setLastSavedLogSummary: vi.fn(),
        setLastSavedLogIds,
        logIntent: null as null,
        setCurrentRoute: vi.fn(),
        setLastLabourLogIds: vi.fn(),
    });

    beforeEach(() => {
        vi.clearAllMocks();
        createFromVoice.mockResolvedValue([makeLog('V1')]);
        createFromManual.mockResolvedValue([makeLog('M1')]);
        confirmAndSave.mockResolvedValue(undefined);
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: ['V1'], skippedLogIds: [] });
    });

    it('stamps autoSavedFromVoice and starts the phone copy as a DRAFT (only his own confirm makes it confirmed)', async () => {
        const { result } = renderHook(() => useLogCommands(props()));
        let saved: DailyLog[] | null = null;
        await act(async () => { saved = await result.current.handleAutoSave(parse, undefined, { autoSavedFromVoice: true }); });

        const written = confirmAndSave.mock.calls[0][0] as DailyLog[];
        expect(written[0].autoSavedFromVoice).toBe(true);
        expect(written[0].verification?.status).toBe(LogVerificationStatus.DRAFT);
        expect(enqueueLogsForSync.mock.calls[0][0][0].autoSavedFromVoice).toBe(true);
        expect(saved).toEqual(written);
        expect(setStatus).toHaveBeenLastCalledWith('success');
        // The result screen says "लक्षात ठेवलं" itself: the voice path's one toast keeps only the day's progress
        // (round 3, I13-V2-m8) — no second phone claim, and no "नोंद".
        expect(setToast).toHaveBeenCalledTimes(1);
        const { message } = setToast.mock.calls[0][0] as { message: string };
        expect(message).toMatch(/\d+% .*\d+%/);
        expect(message).not.toContain('लक्षात ठेवलं');
        expect(message).not.toContain('नोंद');
    });

    it('a typed / hand-filled save never carries autoSavedFromVoice', async () => {
        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => { await result.current.handleManualSubmit({ cropActivities: [] }); });
        const written = confirmAndSave.mock.calls[0][0] as DailyLog[];
        expect(written[0]).not.toHaveProperty('autoSavedFromVoice');
        expect(written[0].verification?.status).toBe(LogVerificationStatus.APPROVED);
    });

    it('onWritten runs only AFTER the durable write resolved', async () => {
        const order: string[] = [];
        let finish!: () => void;
        confirmAndSave.mockImplementation(() => new Promise<void>(r => { finish = () => { order.push('written'); r(); }; }));
        const onWritten = vi.fn(async () => { order.push('result-screen'); });
        const { result } = renderHook(() => useLogCommands(props()));

        let pending!: Promise<DailyLog[] | null>;
        act(() => { pending = result.current.handleAutoSave(parse, undefined, { autoSavedFromVoice: true, onWritten }); });
        await act(async () => { await Promise.resolve(); });
        expect(onWritten).not.toHaveBeenCalled();
        await act(async () => { finish(); await pending; });
        expect(order).toEqual(['written', 'result-screen']);
        expect(onWritten).toHaveBeenCalledWith([expect.objectContaining({ id: 'V1', autoSavedFromVoice: true })]);
    });

    it('a write that FAILED claims nothing and takes back the optimistic copy', async () => {
        confirmAndSave.mockRejectedValue(new Error('IndexedDB full'));
        const onWritten = vi.fn();
        const { result } = renderHook(() => useLogCommands(props()));
        let saved: DailyLog[] | null = [];
        await act(async () => { saved = await result.current.handleAutoSave(parse, undefined, { autoSavedFromVoice: true, onWritten }); });

        expect(saved).toBeNull();
        expect(onWritten).not.toHaveBeenCalled();
        expect(setStatus).not.toHaveBeenCalledWith('success');
        expect(setLastSavedLogIds).not.toHaveBeenCalled();
        expect(enqueueLogsForSync).not.toHaveBeenCalled();
        // The rollback drops exactly the record that was not kept, and nothing else.
        const rollback = setHistory.mock.calls.at(-1)?.[0] as (prev: DailyLog[]) => DailyLog[];
        expect(rollback([makeLog('V1'), makeLog('OLD')]).map(l => l.id)).toEqual(['OLD']);
    });

    it('a step that fails AFTER the write still shows the saved record (a retry would mint a second copy)', async () => {
        enqueueLogsForSync.mockRejectedValue(new Error('queue'));
        const { result } = renderHook(() => useLogCommands(props()));
        let saved: DailyLog[] | null = null;
        await act(async () => { saved = await result.current.handleAutoSave(parse, undefined, { autoSavedFromVoice: true }); });
        expect(saved).not.toBeNull();
        expect(setLastSavedLogIds).toHaveBeenLastCalledWith(['V1']);
        expect(setStatus).toHaveBeenLastCalledWith('success');
    });

    // I13-V3 m6 — the typed path's saved card ("कुठे") is Marathi: no English "Farm" / "Unknown Crop" fallback.
    it('the saved card\'s place never falls back to English: the whole farm in Marathi, an unknown crop or plot as "—"', async () => {
        const farmWide = { ...makeLog('FW'), context: { selection: [{ cropId: 'FARM_GLOBAL', selectedPlotIds: [] }] } } as unknown as DailyLog;
        const unknownCrop = { ...makeLog('UC'), context: { selection: [{ cropId: 'gone', selectedPlotIds: ['p9'] }] } } as unknown as DailyLog;
        createFromManual.mockResolvedValue([farmWide, unknownCrop]);
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: ['FW', 'UC'], skippedLogIds: [] });
        const setLastSavedLogSummary = vi.fn();
        const { result } = renderHook(() => useLogCommands({ ...props(), setLastSavedLogSummary }));
        await act(async () => { await result.current.handleManualSubmit({ cropActivities: [] }); });
        const summary = setLastSavedLogSummary.mock.calls.at(-1)?.[0] as Array<{ logId: string; cropName: string; plotName: string }>;
        expect(summary.map(s => [s.logId, s.cropName, s.plotName])).toEqual([
            ['FW', 'संपूर्ण शेत', 'संपूर्ण शेत'],
            ['UC', '—', '—'], // on a plot whose name is not known here: not "the whole farm" either
        ]);
    });
});
