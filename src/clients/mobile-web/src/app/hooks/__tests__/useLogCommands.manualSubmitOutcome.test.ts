// spec: 2026-08-14-founder-decisions-launch-cohort-and-scope — fix round 2.
// @vitest-environment jsdom
//
// COVERAGE GAP (independent review, round 2) — nothing asserted
// `handleManualSubmit`'s return value anywhere in this hook's own test
// suite. `AiDraftsPage` now trusts that signal to decide whether a farmer's
// offline draft may be marked reviewed; without a test AT THE SOURCE, a
// future stray `return true` (or `'saved'`) on a guard path would silently
// re-open Critical 1 (a no-op save marked reviewed) with nothing here to
// catch it.
//
// This file pins the full `ManualSubmitOutcome` contract directly:
//   - each guard path returns its correct outcome
//   - the CREATE and EDIT success paths both return 'saved'
//   - NEW 2(b) — a throw AFTER the durable write (inside the same `try`, in
//     the sync-enqueue or summary-calc step) still returns 'saved', not
//     'not_saved' — the record is safe and a caller must never be told to
//     retry it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLogCommands } from '../useLogCommands';
import type { FarmerProfile } from '../../../types';

const {
    createFromManual,
    confirmAndSave,
    updateLog,
    enqueueLogsForSync,
} = vi.hoisted(() => ({
    createFromManual: vi.fn(),
    confirmAndSave: vi.fn(),
    updateLog: vi.fn(),
    enqueueLogsForSync: vi.fn(),
}));

vi.mock('../../providers/DataSourceProvider', () => ({
    useDataSource: () => ({ dataSource: { logs: {} } }),
}));

vi.mock('../../../features/logs/services/logSyncMutationService', () => ({
    enqueueLogsForSync,
}));

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => { }, t: (key: string) => key }),
}));

vi.mock('../../../application/services/LogCommandService', () => ({
    LogCommandServiceImpl: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.createFromManual = createFromManual;
        this.createFromVoice = vi.fn();
        this.confirmAndSave = confirmAndSave;
        this.updateLog = updateLog;
    }),
}));

const freshLog = () => ({
    id: 'log-1',
    date: '2026-08-15',
    context: { selection: [{ cropId: 'c1', selectedPlotIds: ['p1'] }] },
    cropActivities: [],
    irrigation: [],
    labour: [{ id: 'lab-1', count: 8 }],
    inputs: [],
    machinery: [],
    plannedTasks: [],
});

/** A promise the test resolves by hand, so a save can be held "in flight". */
const deferred = () => {
    let resolve!: (value?: unknown) => void;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
};

const props = (over: Record<string, unknown> = {}) => ({
    hasActiveLogContext: true,
    logScope: {
        selectedCropIds: ['c1'],
        selectedPlotIds: ['p1'],
        mode: 'single' as const,
        applyPolicy: 'broadcast' as const,
    },
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
    setStatus: vi.fn(),
    setLastSavedLogSummary: vi.fn(),
    setLastSavedLogIds: vi.fn(),
    logIntent: null as null,
    setCurrentRoute: vi.fn(),
    setLastLabourLogIds: vi.fn(),
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    createFromManual.mockResolvedValue([freshLog()]);
    confirmAndSave.mockResolvedValue(undefined);
    updateLog.mockResolvedValue({ success: true, log: freshLog(), persistedLabourCorrections: 0 });
    enqueueLogsForSync.mockResolvedValue({ queuedLogIds: ['log-1'], skippedLogIds: [] });
});

describe('handleManualSubmit — ManualSubmitOutcome, each path', () => {
    it('returns not_saved when there is no active log context (SAFE GUARD)', async () => {
        const { result } = renderHook(() => useLogCommands(props({ hasActiveLogContext: false })));

        let outcome;
        await act(async () => {
            outcome = await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(outcome).toBe('not_saved');
        expect(createFromManual).not.toHaveBeenCalled();
    });

    it('returns already_saving for the losing tap of a double-tap — the winning tap still returns saved', async () => {
        const held = deferred();
        confirmAndSave.mockReturnValue(held.promise);
        const { result } = renderHook(() => useLogCommands(props()));

        let firstOutcome;
        let secondOutcome;
        await act(async () => {
            const first = result.current.handleManualSubmit({ cropActivities: [] });
            const second = result.current.handleManualSubmit({ cropActivities: [] });
            held.resolve();
            [firstOutcome, secondOutcome] = await Promise.all([first, second]);
        });

        expect(firstOutcome).toBe('saved');
        expect(secondOutcome).toBe('already_saving');
    });

    it('returns saved on a successful CREATE', async () => {
        const { result } = renderHook(() => useLogCommands(props()));

        let outcome;
        await act(async () => {
            outcome = await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(outcome).toBe('saved');
        expect(confirmAndSave).toHaveBeenCalledTimes(1);
    });

    it('returns saved on a successful EDIT (originalLogId present)', async () => {
        const { result } = renderHook(() => useLogCommands(props()));

        let outcome;
        await act(async () => {
            outcome = await result.current.handleManualSubmit({ originalLogId: 'log-1' });
        });

        expect(outcome).toBe('saved');
        expect(updateLog).toHaveBeenCalledTimes(1);
    });

    it('returns not_saved when the write itself throws before anything is persisted (CREATE)', async () => {
        createFromManual.mockRejectedValueOnce(new Error('network down'));
        const { result } = renderHook(() => useLogCommands(props()));

        let outcome;
        await act(async () => {
            outcome = await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(outcome).toBe('not_saved');
        expect(confirmAndSave).not.toHaveBeenCalled();
    });

    it('returns not_saved when the write itself fails (EDIT, result.success: false)', async () => {
        updateLog.mockResolvedValueOnce({ success: false, error: 'stale version' });
        const { result } = renderHook(() => useLogCommands(props()));

        let outcome;
        await act(async () => {
            outcome = await result.current.handleManualSubmit({ originalLogId: 'log-1' });
        });

        expect(outcome).toBe('not_saved');
    });

    // NEW 2(b) — THE finding this file exists to pin. `confirmAndSave` (the
    // actual Dexie write) succeeds; `enqueueForSyncAndNoteSkips` (a step
    // AFTER the write, same `try`) then throws. The record IS in the
    // ledger — the outcome must say so, not tell the caller to retry into a
    // duplicate.
    it('returns saved (not not_saved) when a step AFTER the write throws', async () => {
        confirmAndSave.mockResolvedValue(undefined);
        enqueueLogsForSync.mockRejectedValueOnce(new Error('sync enqueue boom'));
        const setError = vi.fn();
        const { result } = renderHook(() => useLogCommands(props({ setError })));

        let outcome;
        await act(async () => {
            outcome = await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(outcome).toBe('saved');
        expect(confirmAndSave).toHaveBeenCalledTimes(1);
        // The caller must never be told "failed, try again" for a record
        // that is already safely in the ledger — a retry would duplicate it.
        expect(setError).not.toHaveBeenCalledWith('Failed to save logs. Please try again.');
    });
});
