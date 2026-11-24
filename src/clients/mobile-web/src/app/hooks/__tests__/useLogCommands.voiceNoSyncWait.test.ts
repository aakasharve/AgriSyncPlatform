// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-instant-phase-a-2026-11-23 (Task 3) — the voice auto-save shows its result without waiting for a sync
 * cycle: it asks `enqueueLogsForSync` NOT to await the sync (`awaitSync: false`), and the saved state (`success`, the
 * saved ids, the "not queued" badge from the enqueue outcome) is set as soon as the enqueue answers. A hand-filled save
 * is asked nothing new: it keeps awaiting the sync, exactly as before.
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
    verification: { status: LogVerificationStatus.APPROVED, required: false },
} as unknown as DailyLog);

const parse = { summary: 'x', labour: [{ id: 'l', count: 4 }] } as unknown as AgriLogResponse;

describe('useLogCommands — the voice save does not wait for a sync cycle', () => {
    const setStatus = vi.fn();
    const setLastSavedLogIds = vi.fn();
    const setLastSavedLogSummary = vi.fn();

    const props = () => ({
        hasActiveLogContext: true,
        logScope: { selectedCropIds: ['c1'], selectedPlotIds: ['p1'], mode: 'single' as const, applyPolicy: 'broadcast' as const },
        setLogScope: vi.fn(),
        crops: [],
        farmerProfile: { operators: [], activeOperatorId: 'op1' } as unknown as FarmerProfile,
        history: [],
        plannedTasks: [],
        isDemoMode: false,
        setHistory: vi.fn(),
        setPlannedTasks: vi.fn(),
        setToast: vi.fn(),
        setError: vi.fn(),
        setDraftLog: vi.fn(),
        setRecordingSegment: vi.fn(),
        setMode: vi.fn(),
        setMainView: vi.fn(),
        setStatus,
        setLastSavedLogSummary,
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

    it('the voice auto-save asks for the sync to be started, not awaited', async () => {
        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => { await result.current.handleAutoSave(parse, undefined, { autoSavedFromVoice: true }); });

        expect(enqueueLogsForSync).toHaveBeenCalledTimes(1);
        expect(enqueueLogsForSync.mock.calls[0][1]).toEqual({ awaitSync: false });
    });

    it('the saved state is set as soon as the enqueue answers: success, the ids, and the badge from the enqueue outcome', async () => {
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: ['V1'] }); // could NOT be queued
        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => { await result.current.handleAutoSave(parse, undefined, { autoSavedFromVoice: true }); });

        expect(setStatus).toHaveBeenLastCalledWith('success');
        expect(setLastSavedLogIds).toHaveBeenLastCalledWith(['V1']);
        const summary = setLastSavedLogSummary.mock.calls.at(-1)?.[0] as Array<{ logId: string; syncQueued: boolean | null }>;
        expect(summary[0]).toMatchObject({ logId: 'V1', syncQueued: false }); // "not queued" is still said, from the enqueue
    });

    it('a hand-filled save is asked nothing new: it keeps awaiting the sync', async () => {
        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => { await result.current.handleManualSubmit({ cropActivities: [] }); });

        expect(enqueueLogsForSync).toHaveBeenCalledTimes(1);
        expect(enqueueLogsForSync.mock.calls[0]).toHaveLength(1); // the logs alone: the default (awaited) applies
    });
});
