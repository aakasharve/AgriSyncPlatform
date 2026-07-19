// spec: 2026-07-13-labour-attendance-approval-design (Task 3.5)
// @vitest-environment jsdom
//
// Of the four log-command save paths (handleAutoSave, handleFinalConfirm,
// handleManualSubmit, handleWizardSubmit), only handleManualSubmit is
// actually reachable from the UI today: ManualEntry's onSubmit prop
// (mainView.tsx) is wired to it, and voice capture ALWAYS routes through
// ManualEntry for review before saving (useVoiceRecorder.commitParsedDraft
// never auto-saves). handleAutoSave / handleWizardSubmit / handleFinalConfirm
// are defined and returned by the hook but have no caller anywhere in the
// app (verified by repo-wide grep) — so this spec covers the one path that
// matters: saving while `logIntent === 'labour'` must route back to Labour
// Management and record which log(s) were saved, instead of showing the
// generic "Saved to Ledger" screen.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLogCommands } from '../useLogCommands';
import type { FarmerProfile } from '../../../types';

const FAKE_LOG = {
    id: 'log-1',
    date: '2026-07-19',
    context: { selection: [{ cropId: 'c1', selectedPlotIds: ['p1'] }] },
    cropActivities: [],
    irrigation: [],
    labour: [{ id: 'l1', maleCount: 2, femaleCount: 0, totalCost: 800 }],
    inputs: [],
    machinery: [],
    plannedTasks: [],
};

// vi.hoisted — vi.mock factories are hoisted above all other module code
// (including plain `const` declarations), so any spy the factory closes
// over must be created through vi.hoisted to avoid a TDZ reference.
const { createFromManual, confirmAndSave } = vi.hoisted(() => ({
    createFromManual: vi.fn(),
    confirmAndSave: vi.fn(),
}));

vi.mock('../../providers/DataSourceProvider', () => ({
    useDataSource: () => ({ dataSource: { logs: {} } }),
}));

vi.mock('../../../features/logs/services/logSyncMutationService', () => ({
    enqueueLogsForSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../application/services/LogCommandService', () => ({
    // Constructor mock: `new LogCommandServiceImpl(...)` requires the
    // stored implementation to be constructible — an arrow function is
    // NOT (throws "is not a constructor"), so this must be a plain
    // `function` expression, not `() => ({...})`.
    LogCommandServiceImpl: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.createFromManual = createFromManual;
        this.confirmAndSave = confirmAndSave;
        this.updateLog = vi.fn();
        this.createFromVoice = vi.fn();
    }),
}));

describe('useLogCommands.handleManualSubmit — labour auto-return (Task 3.5)', () => {
    beforeEach(() => {
        createFromManual.mockReset().mockResolvedValue([FAKE_LOG]);
        confirmAndSave.mockReset().mockResolvedValue(undefined);
    });

    const baseProps = () => ({
        hasActiveLogContext: true,
        logScope: { selectedCropIds: ['c1'], selectedPlotIds: ['p1'], mode: 'single' as const, applyPolicy: 'broadcast' as const },
        setLogScope: vi.fn(),
        crops: [],
        farmerProfile: { operators: [], activeOperatorId: 'op1' } as unknown as FarmerProfile,
        history: [],
        plannedTasks: [],
        isDemoMode: true,
        setHistory: vi.fn(),
        setPlannedTasks: vi.fn(),
        setToast: vi.fn(),
        setError: vi.fn(),
        setDraftLog: vi.fn(),
        setRecordingSegment: vi.fn(),
        setMode: vi.fn(),
        setMainView: vi.fn(),
        setLastSavedLogSummary: vi.fn(),
        setLastSavedLogIds: vi.fn(),
    });

    it('routes to "labour" and records the saved log ids when logIntent is "labour"', async () => {
        const setStatus = vi.fn();
        const setCurrentRoute = vi.fn();
        const setLastLabourLogIds = vi.fn();

        const { result } = renderHook(() => useLogCommands({
            ...baseProps(),
            setStatus,
            logIntent: 'labour',
            setCurrentRoute,
            setLastLabourLogIds,
        }));

        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(setLastLabourLogIds).toHaveBeenCalledWith(['log-1']);
        expect(setCurrentRoute).toHaveBeenCalledWith('labour');
        // The generic success screen must NOT be shown for this path.
        expect(setStatus).toHaveBeenCalledWith('idle');
        expect(setStatus).not.toHaveBeenCalledWith('success');
    });

    it('shows the normal success screen and does not touch labour routing when logIntent is null', async () => {
        const setStatus = vi.fn();
        const setCurrentRoute = vi.fn();
        const setLastLabourLogIds = vi.fn();

        const { result } = renderHook(() => useLogCommands({
            ...baseProps(),
            setStatus,
            logIntent: null,
            setCurrentRoute,
            setLastLabourLogIds,
        }));

        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(setStatus).toHaveBeenCalledWith('success');
        expect(setCurrentRoute).not.toHaveBeenCalled();
        expect(setLastLabourLogIds).not.toHaveBeenCalled();
    });
});
