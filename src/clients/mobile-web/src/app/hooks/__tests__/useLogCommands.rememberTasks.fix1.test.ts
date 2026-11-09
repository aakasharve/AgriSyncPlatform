// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 fix round 1, review L001) - each of the FOUR save paths of `useLogCommands`
 * (handleAutoSave, handleFinalConfirm, handleManualSubmit, handleWizardSubmit) hands the logs it just wrote to `rememberLogTasks`, which is how a
 * spoken reminder reaches the one list at once. A test that fails if a call site is dropped.
 *
 * Seam: the REAL hook with the REAL save paths; only the services under it (log command service, sync enqueue) and `rememberLogTasks` itself are
 * stand-ins, so what is asserted is exactly "this path called it with the logs it wrote".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLogCommands } from '../useLogCommands';
import type { AgriLogResponse, DailyLog, FarmerProfile } from '../../../types';

const { createFromManual, createFromVoice, confirmAndSave, updateLog, enqueueLogsForSync, rememberLogTasks } = vi.hoisted(() => ({
    createFromManual: vi.fn(), createFromVoice: vi.fn(), confirmAndSave: vi.fn(), updateLog: vi.fn(), enqueueLogsForSync: vi.fn(), rememberLogTasks: vi.fn(),
}));

vi.mock('../../providers/DataSourceProvider', () => ({ useDataSource: () => ({ dataSource: { logs: {} } }) }));
vi.mock('../../../features/logs/services/logSyncMutationService', () => ({ enqueueLogsForSync }));
vi.mock('../../helpers/rememberLogTasks', () => ({ rememberLogTasks }));
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
    id, date: '2026-10-26', context: { selection: [{ cropId: 'c1', selectedPlotIds: ['p1'] }] },
    cropActivities: [], irrigation: [], inputs: [], machinery: [], plannedTasks: [], labour: [{ id: `lab-${id}`, count: 4 }],
} as unknown as DailyLog);

const props = () => ({
    hasActiveLogContext: true,
    logScope: { selectedCropIds: ['c1'], selectedPlotIds: ['p1'], mode: 'single' as const, applyPolicy: 'broadcast' as const },
    setLogScope: vi.fn(), crops: [], farmerProfile: { operators: [], activeOperatorId: 'op1' } as unknown as FarmerProfile, history: [], plannedTasks: [],
    isDemoMode: false, setHistory: vi.fn(), setPlannedTasks: vi.fn(), setToast: vi.fn(), setError: vi.fn(), setDraftLog: vi.fn(), setRecordingSegment: vi.fn(),
    setMode: vi.fn(), setMainView: vi.fn(), setStatus: vi.fn(), setLastSavedLogSummary: vi.fn(), setLastSavedLogIds: vi.fn(),
    logIntent: null as null, setCurrentRoute: vi.fn(), setLastLabourLogIds: vi.fn(),
});

const parse = { summary: 'x', labour: [{ id: 'l', count: 4 }] } as unknown as AgriLogResponse;

describe('every save path remembers the planned items of the logs it wrote', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        createFromVoice.mockResolvedValue([makeLog('V1')]);
        createFromManual.mockResolvedValue([makeLog('M1')]);
        confirmAndSave.mockResolvedValue(undefined);
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: [] });
    });

    it('handleAutoSave (the voice auto-save)', async () => {
        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => { await result.current.handleAutoSave(parse, undefined, { autoSavedFromVoice: true }); });
        expect(rememberLogTasks).toHaveBeenCalledTimes(1);
        expect(rememberLogTasks).toHaveBeenCalledWith(false, expect.any(Function), (confirmAndSave.mock.calls[0][0] as DailyLog[]));
    });

    it('handleFinalConfirm (the reviewed voice draft)', async () => {
        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => { await result.current.handleFinalConfirm(parse, null); });
        expect(confirmAndSave).toHaveBeenCalledTimes(1);
        expect(rememberLogTasks).toHaveBeenCalledTimes(1);
        expect(rememberLogTasks).toHaveBeenCalledWith(false, expect.any(Function), (confirmAndSave.mock.calls[0][0] as DailyLog[]));
    });

    it('handleManualSubmit (a typed day)', async () => {
        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => { await result.current.handleManualSubmit({ cropActivities: [] }); });
        expect(confirmAndSave).toHaveBeenCalledTimes(1);
        expect(rememberLogTasks).toHaveBeenCalledTimes(1);
        expect(rememberLogTasks).toHaveBeenCalledWith(false, expect.any(Function), (confirmAndSave.mock.calls[0][0] as DailyLog[]));
    });

    it('handleWizardSubmit (the guided entry)', async () => {
        const logs = [makeLog('W1')];
        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => { await result.current.handleWizardSubmit(logs); });
        expect(confirmAndSave).toHaveBeenCalledTimes(1);
        expect(rememberLogTasks).toHaveBeenCalledTimes(1);
        expect(rememberLogTasks).toHaveBeenCalledWith(false, expect.any(Function), logs);
    });
});
