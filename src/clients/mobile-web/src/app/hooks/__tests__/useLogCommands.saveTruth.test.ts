// spec: 2026-07-13-labour-attendance-approval-design
// Labour Phase 2 -> Phase 1 (honesty backstop), Task T2.
// @vitest-environment jsdom
//
// THE BUG THESE TESTS LOCK OUT
// ----------------------------
// `enqueueLogsForSync` has always returned `skippedLogIds` — the logs it could
// NOT queue for `/sync/push`, because `resolveSyncTarget` found them no plot or
// no crop cycle. Until T2 that array had zero production consumers: all four
// call sites in `useLogCommands.ts` threw the whole result away and fired a
// success toast unconditionally. The exact records the app already knew it had
// dropped were the records the farmer was told were saved.
//
// A farmer selecting "संपूर्ण शेत" recorded eight workers, read
// `Logged. Day closure: 40% -> 60%`, and the record never left the phone.
// Nobody found out until they went looking for it later and it was gone.
//
// Doctrine `P4` — no fabricated figure reaches a farmer. `P5` — a truthful
// missing feature beats a fake working one. A success toast is a claim about
// the world; it was a constant wearing the costume of a result.
//
// There is a FIFTH toast: the `originalLogId` EDIT branch, which never calls
// `enqueueLogsForSync` at all and fired the same success line off
// `result.success` alone — the same value returned by an edit that persisted
// absolutely nothing. Its honest evidence is `persistedLabourCorrections`.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLogCommands } from '../useLogCommands';
import type { FarmerProfile } from '../../../types';

const makeLog = (id: string) => ({
    id,
    date: '2026-08-12',
    context: { selection: [{ cropId: 'c1', selectedPlotIds: [`plot-${id}`] }] },
    cropActivities: [],
    irrigation: [],
    labour: [{ id: `lab-${id}`, maleCount: 2, femaleCount: 0, totalCost: 800 }],
    inputs: [],
    machinery: [],
    plannedTasks: [],
});

const {
    createFromManual,
    createFromVoice,
    confirmAndSave,
    updateLog,
    enqueueLogsForSync,
    langRef,
} = vi.hoisted(() => ({
    createFromManual: vi.fn(),
    createFromVoice: vi.fn(),
    confirmAndSave: vi.fn(),
    updateLog: vi.fn(),
    enqueueLogsForSync: vi.fn(),
    // A ref, not a bare `let`: vi.mock factories run during the import phase,
    // before this module's body executes, so a plain binding would be in TDZ.
    // Only `.current` is dereferenced, and that happens at render time.
    langRef: { current: 'mr' as 'mr' | 'en' },
}));

vi.mock('../../providers/DataSourceProvider', () => ({
    useDataSource: () => ({ dataSource: { logs: {} } }),
}));

vi.mock('../../../features/logs/services/logSyncMutationService', () => ({
    enqueueLogsForSync,
}));

// The real `useLanguage` throws outside `<LanguageProvider>` by design and
// `renderHook` mounts no providers. `t` is intentionally NOT stubbed to the
// identity function: the hook resolves the label through the pure
// `t(key, language)` in `i18n/translations.ts`, so these tests assert the REAL
// shipped strings in both languages rather than a key.
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: langRef.current, setLanguage: () => { }, t: (key: string) => key }),
}));

vi.mock('../../../application/services/LogCommandService', () => ({
    // Must be a plain `function` expression — `new LogCommandServiceImpl(...)`
    // cannot construct an arrow function.
    LogCommandServiceImpl: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.createFromManual = createFromManual;
        this.createFromVoice = createFromVoice;
        this.confirmAndSave = confirmAndSave;
        this.updateLog = updateLog;
    }),
}));

/** The exact strings shipped in `i18n/translations.ts` under the `sync` namespace. */
const NEEDS_FIX_MR = 'अडकलं — तपासा';
const NEEDS_FIX_EN = 'Stuck — check';

type ToastCall = { message: string; type: 'success' | 'error' } | null;
type ToastSetter = (toast: ToastCall) => void;

describe('useLogCommands — a save may not claim what was never queued (T2)', () => {
    let setToast: ReturnType<typeof vi.fn<ToastSetter>>;

    beforeEach(() => {
        vi.clearAllMocks();
        langRef.current = 'mr';
        setToast = vi.fn<ToastSetter>();
        confirmAndSave.mockResolvedValue(undefined);
        createFromManual.mockResolvedValue([makeLog('1')]);
        createFromVoice.mockResolvedValue([makeLog('1')]);
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: ['1'], skippedLogIds: [] });
    });

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
        // The real app path. Demo mode never enqueues and is covered separately.
        isDemoMode: false,
        setHistory: vi.fn(),
        setPlannedTasks: vi.fn(),
        setToast,
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

    const lastToast = (): ToastCall =>
        (setToast.mock.calls.at(-1)?.[0] ?? null) as ToastCall;

    const everyToastMessage = (): string[] =>
        setToast.mock.calls.map(call => (call[0] as ToastCall)?.message ?? '');

    // ---------------------------------------------------------------- site 3
    // handleManualSubmit is the ONE path with a live caller today
    // (`mainView.tsx:443` -> ManualEntry's onSubmit).

    it('nothing queued: says so, shows NEEDS_FIX, and uses NO success wording', async () => {
        createFromManual.mockResolvedValue([makeLog('1'), makeLog('2'), makeLog('3')]);
        enqueueLogsForSync.mockResolvedValue({
            queuedLogIds: [],
            skippedLogIds: ['1', '2', '3'],
        });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(lastToast()).toEqual({
            message: `0 of 3 queued to send. ${NEEDS_FIX_MR}`,
            type: 'error',
        });
        // The specific lie: the old wording, on a save that queued nothing.
        expect(everyToastMessage().join('\n')).not.toContain('Logged');
        expect(everyToastMessage().join('\n')).not.toContain('Day closure');
    });

    it('partially queued: reports the QUEUED count, never the submitted count', async () => {
        createFromManual.mockResolvedValue([makeLog('1'), makeLog('2'), makeLog('3')]);
        enqueueLogsForSync.mockResolvedValue({
            queuedLogIds: ['1'],
            skippedLogIds: ['2', '3'],
        });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(lastToast()).toEqual({
            message: `1 of 3 queued to send. ${NEEDS_FIX_MR}`,
            type: 'error',
        });
        // Rounding two dropped records up into the saved figure is the exact
        // `P4` violation this task removes.
        expect(lastToast()?.message).not.toContain('3 of 3');
    });

    it('everything queued: the happy path is unchanged', async () => {
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: ['1'], skippedLogIds: [] });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(lastToast()?.type).toBe('success');
        expect(lastToast()?.message).toMatch(/^Logged\. Day closure: \d+% -> \d+%$/);
    });

    it('an English farmer is told this in English, not in Marathi', async () => {
        langRef.current = 'en';
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: ['1'] });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(lastToast()).toEqual({
            message: `0 of 1 queued to send. ${NEEDS_FIX_EN}`,
            type: 'error',
        });
    });

    it('demo mode never enqueues, so it makes no sync claim either way', async () => {
        const { result } = renderHook(() => useLogCommands(props({ isDemoMode: true })));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(enqueueLogsForSync).not.toHaveBeenCalled();
        expect(lastToast()?.type).toBe('success');
        expect(lastToast()?.message).toMatch(/^Logged\. Day closure: /);
    });

    // ---------------------------------------------------------------- site 4
    // handleWizardSubmit has no caller today, but its "Saved to N plots"
    // sentence took N from the SUBMITTED set — a fabricated number the moment
    // any plot was skipped.

    it('handleWizardSubmit: a fully-skipped broadcast never claims "Saved to N plots"', async () => {
        enqueueLogsForSync.mockResolvedValue({
            queuedLogIds: [],
            skippedLogIds: ['1', '2', '3'],
        });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleWizardSubmit(
                [makeLog('1'), makeLog('2'), makeLog('3')] as never,
            );
        });

        expect(lastToast()).toEqual({
            message: `0 of 3 queued to send. ${NEEDS_FIX_MR}`,
            type: 'error',
        });
        expect(everyToastMessage().join('\n')).not.toContain('Saved to');
    });

    it('handleWizardSubmit: the plot count comes off the queued result', async () => {
        enqueueLogsForSync.mockResolvedValue({
            queuedLogIds: ['1', '2'],
            skippedLogIds: [],
        });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleWizardSubmit([makeLog('1'), makeLog('2')] as never);
        });

        expect(lastToast()?.type).toBe('success');
        expect(lastToast()?.message).toMatch(/^Logged once\. Saved to 2 plots\. Day closure: /);
    });

    // ------------------------------------------------------------ sites 1 & 2
    // No caller in the app today (verified by repo-wide grep), but both are on
    // the hook's public surface and a future caller must not inherit the lie.

    it('handleAutoSave: a fully-skipped voice save shows NEEDS_FIX, not "Logged."', async () => {
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: ['1'] });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleAutoSave({ summary: 'x' } as never);
        });

        expect(lastToast()).toEqual({
            message: `0 of 1 queued to send. ${NEEDS_FIX_MR}`,
            type: 'error',
        });
    });

    it('handleFinalConfirm: a fully-skipped confirm shows NEEDS_FIX, not "Logged."', async () => {
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: ['1'] });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleFinalConfirm({ summary: 'x' } as never, null);
        });

        expect(lastToast()).toEqual({
            message: `0 of 1 queued to send. ${NEEDS_FIX_MR}`,
            type: 'error',
        });
    });
});

// ---------------------------------------------------------------------- site 5
describe('useLogCommands — the EDIT path may not claim a save it cannot evidence (T2 §3b)', () => {
    let setToast: ReturnType<typeof vi.fn<ToastSetter>>;

    beforeEach(() => {
        vi.clearAllMocks();
        langRef.current = 'mr';
        setToast = vi.fn<ToastSetter>();
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: [] });
    });

    const editProps = () => ({
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
        setToast,
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
    });

    const submitEdit = async () => {
        const { result } = renderHook(() => useLogCommands(editProps()));
        await act(async () => {
            await result.current.handleManualSubmit({ originalLogId: '1', cropActivities: [] });
        });
    };

    it('an edit that persisted nothing is not called saved', async () => {
        updateLog.mockResolvedValue({
            success: true,
            log: makeLog('1'),
            persistedLabourCorrections: 0,
        });

        await submitEdit();

        // `success: true` used to be enough to fire `Logged. Day closure: ...`.
        // It is also what an edit with no server-side path at all returns.
        expect(setToast).toHaveBeenCalledWith({
            message: 'Shown here only — this edit is not saved yet.',
            type: 'error',
        });
        expect(setToast).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'success' }),
        );
    });

    it('an edit whose labour corrections the server accepted says exactly that, and no more', async () => {
        updateLog.mockResolvedValue({
            success: true,
            log: makeLog('1'),
            persistedLabourCorrections: 2,
        });

        await submitEdit();

        expect(setToast).toHaveBeenCalledWith({
            message: 'Saved: 2 labour corrections sent to the server.',
            type: 'success',
        });
    });

    it('one correction reads as one, not as "1 corrections"', async () => {
        updateLog.mockResolvedValue({
            success: true,
            log: makeLog('1'),
            persistedLabourCorrections: 1,
        });

        await submitEdit();

        expect(setToast).toHaveBeenCalledWith({
            message: 'Saved: 1 labour correction sent to the server.',
            type: 'success',
        });
    });

    it('an older result with no evidence field at all is treated as no evidence', async () => {
        // Defends the `?? 0`: absence must never be read as success.
        updateLog.mockResolvedValue({ success: true, log: makeLog('1') });

        await submitEdit();

        expect(setToast).toHaveBeenCalledWith({
            message: 'Shown here only — this edit is not saved yet.',
            type: 'error',
        });
    });
});
