// spec: 2026-08-12-labour-phase2-server-truth-farm-context
// LABOUR_PHASE2 PHASE 4 (§A7.2) — double-tapping Save produces ONE record.
// @vitest-environment jsdom
//
// THE REACHABLE PATH, traced rather than assumed:
//
//   `mainView.tsx:489`  onSubmit={handleManualSubmit}
//   `ManualEntry.tsx:326`  onSubmit(userDraft)   <- NOT awaited
//   and the Save control carries no disabled state
//
// So two taps run `handleManualSubmit` concurrently. On the create branch each
// run calls `createFromManual`, `LogFactory` mints a FRESH log id per call, and
// the two records reach `/sync/push` under two different `clientRequestId`s —
// which the server's `(deviceId, clientRequestId)` dedupe cannot catch, because
// they are not retries of one action. They look like two genuinely different
// records, because by the time they reach the server that is what they are.
//
// This file pins the guard at the level a farmer experiences it: how many
// records one flurry of taps creates. `app/helpers/__tests__/inFlightSaveLock.test.ts`
// pins the lock's own behaviour, including its expiry.
//
// WHAT IS NOT CLAIMED HERE: the fresh-id defect itself is untouched and stays
// deferred by the plan. Past the lock's ceiling a second tap can still create a
// second record — which is the deliberate trade `P9` requires, and is asserted
// in the lock's own suite rather than hidden.
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

/**
 * A fresh log id per call — `LogFactory`'s actual behaviour, and the reason a
 * double tap yields two records rather than one written twice. If this returned
 * a stable id the test could not tell a duplicate from an overwrite.
 */
let minted = 0;
const freshLog = () => {
    minted += 1;
    return {
        id: `log-${minted}`,
        date: '2026-08-13',
        context: { selection: [{ cropId: 'c1', selectedPlotIds: ['p1'] }] },
        cropActivities: [],
        irrigation: [],
        labour: [{ id: 'lab-1', count: 8 }],
        inputs: [],
        machinery: [],
        plannedTasks: [],
    };
};

/** A promise the test resolves by hand, so a save can be held "in flight". */
const deferred = () => {
    let resolve!: (value?: unknown) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
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
    minted = 0;
    createFromManual.mockImplementation(async () => [freshLog()]);
    confirmAndSave.mockResolvedValue(undefined);
    enqueueLogsForSync.mockResolvedValue({ queuedLogIds: ['log-1'], skippedLogIds: [] });
});

describe('handleManualSubmit — a double tap creates ONE record', () => {
    it('runs the create path once when both taps land while the first is in flight', async () => {
        const held = deferred();
        // The save is genuinely still running when the second tap arrives: this
        // is the concurrency the un-awaited `onSubmit(userDraft)` produces, not
        // two sequential saves.
        confirmAndSave.mockReturnValue(held.promise);

        const { result } = renderHook(() => useLogCommands(props()));

        await act(async () => {
            const first = result.current.handleManualSubmit({ cropActivities: [] });
            const second = result.current.handleManualSubmit({ cropActivities: [] });
            held.resolve();
            await Promise.all([first, second]);
        });

        expect(createFromManual).toHaveBeenCalledTimes(1);
        expect(confirmAndSave).toHaveBeenCalledTimes(1);
        // The number that actually matters: one enqueue, so one record on the
        // wire, so one day's work in the ledger.
        expect(enqueueLogsForSync).toHaveBeenCalledTimes(1);
    });

    it('survives an impatient flurry — five taps, one record', async () => {
        const held = deferred();
        confirmAndSave.mockReturnValue(held.promise);

        const { result } = renderHook(() => useLogCommands(props()));

        await act(async () => {
            const taps = Array.from({ length: 5 }, () =>
                result.current.handleManualSubmit({ cropActivities: [] }));
            held.resolve();
            await Promise.all(taps);
        });

        expect(createFromManual).toHaveBeenCalledTimes(1);
    });

    it('an edit is guarded too: one tap, one correction round', async () => {
        // A second correction POST would mint a second `clientRequestId` for the
        // same farmer action.
        const held = deferred();
        updateLog.mockReturnValue(held.promise);

        const { result } = renderHook(() => useLogCommands(props()));

        await act(async () => {
            const first = result.current.handleManualSubmit({ originalLogId: 'log-1' });
            const second = result.current.handleManualSubmit({ originalLogId: 'log-1' });
            held.resolve({ success: true, log: freshLog(), persistedLabourCorrections: 1 });
            await Promise.all([first, second]);
        });

        expect(updateLog).toHaveBeenCalledTimes(1);
    });

    it('the SECOND save the farmer deliberately makes still goes through', async () => {
        // The guard is in-flight only. Two separate, sequential saves are two
        // separate records and must stay that way — a farmer logging morning
        // work and then afternoon work is not double-tapping.
        const { result } = renderHook(() => useLogCommands(props()));

        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(createFromManual).toHaveBeenCalledTimes(2);
    });

    it('a FAILED save leaves the farmer able to save again immediately', async () => {
        // `P9`. The catch surfaces "Failed to save logs. Please try again." — an
        // instruction that must be followable. A lock released only on success
        // would turn one bad network moment into a lost day of records.
        const setError = vi.fn();
        createFromManual.mockRejectedValueOnce(new Error('network down'));

        const { result } = renderHook(() => useLogCommands(props({ setError })));

        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });
        expect(setError).toHaveBeenCalled();

        createFromManual.mockImplementation(async () => [freshLog()]);
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(createFromManual).toHaveBeenCalledTimes(2);
        expect(confirmAndSave).toHaveBeenCalledTimes(1);
    });

    it('the rejected tap is SILENT — no toast, no error, nothing to dismiss', async () => {
        // `P9`. The guard may not become a nag, a warning or a thing the farmer
        // has to acknowledge. The first tap's own toast is the only feedback.
        const setToast = vi.fn();
        const setError = vi.fn();
        const held = deferred();
        confirmAndSave.mockReturnValue(held.promise);

        const { result } = renderHook(() => useLogCommands(props({ setToast, setError })));

        await act(async () => {
            const first = result.current.handleManualSubmit({ cropActivities: [] });
            const second = result.current.handleManualSubmit({ cropActivities: [] });
            held.resolve();
            await Promise.all([first, second]);
        });

        expect(setError).not.toHaveBeenCalled();
        // Exactly one toast — the successful save's own. Not two, and no extra
        // "already saving" message.
        expect(setToast).toHaveBeenCalledTimes(1);
    });
});
