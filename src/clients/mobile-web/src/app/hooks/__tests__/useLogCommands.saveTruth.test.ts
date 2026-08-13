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
//
// REVIEW ROUND 1 added three more things to hold down:
//
//   B1  The toast is not the only surface. `setStatus('success')` renders a
//       full-screen "Saved to Ledger" panel that lives until the farmer
//       navigates away, while the toast self-destructs after 3000ms. The edit
//       path must never enter `'success'`; a skipped CREATE keeps it (its
//       record IS in the ledger) and carries the sync truth on
//       `lastSavedLogSummary` instead.
//       PHASE 4 UPDATE: B1's original reason — that an edit wrote nothing
//       anywhere — is no longer true; `updateLog` now calls `repo.save`. The
//       panel is still refused, on the reason recorded at
//       `useLogCommands.ts`'s `showSavedToLedgerPanel`: it is a CREATE-shaped
//       confirmation whose body and sync badge have nothing to say about a
//       correction.
//   B3  `अडकलं — तपासा` says "go and check". A skipped log has no home in any
//       queue, so there is nothing to check and nowhere to go.
//   B4  A red toast reading `0 of 1` reads as "your record is gone", and the
//       farmer re-records it — creating a duplicate. The record IS on the
//       phone. Say so first.
//   C-2  The EDIT path's `> 0` branch — the one branch B1 did not cover. It
//       fired a GREEN tick reading "N labour corrections sent to the server."
//       That sentence is true and evidenced. What it left out was the rest of
//       the edit: `ManualEntry` submits the whole log, so one edit changes
//       irrigation hours AND a headcount, and only the labour half has a server
//       path. A green tick over a partial truth.
//       PHASE 4 UPDATE (ruling R19): C-2's remedy — "…shown on screen only —
//       not saved anywhere." — described a MISSING FEATURE truthfully, and
//       Phase 4 built it. Once `updateLog` persisted, that sentence became
//       false the other way round, so the string and the seven tests pinning it
//       were DELETED rather than re-worded. What replaces them is below.
//   C-1  The header chip is the surface the farmer never navigates away from.
//       It derives its claim from `db.mutationQueue`, where a skipped log has
//       no row — and `APPLIED` rows are never pruned, so on any device that has
//       ever synced it kept rendering `पाठवलं ✓` above a panel badge reading
//       `फोनवर सेव्ह ✓ — cannot be sent`, about the same record. The save path
//       is the only place that holds this fact, so it now reports it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLogCommands } from '../useLogCommands';
import type { AppStatus, FarmerProfile } from '../../../types';
import type { LastSavedLogSummaryItem } from '../../uiRuntimeTypes';
import {
    getUnqueueableLogCount,
    resetUnqueueableLogs,
} from '../../../features/sync/status/unqueueableLogs';
import {
    deriveSyncHonestyState,
    EMPTY_SYNC_EVIDENCE,
} from '../../../features/sync/status/syncHonestyState';
import { tf as translateFormat, type Language } from '../../../i18n/translations';

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
const ON_PHONE_MR = 'फोनवर सेव्ह ✓';
const ON_PHONE_EN = 'Saved on phone';

/*
 * THE TAILS ARE RESOLVED, NOT TRANSCRIBED — and that is deliberate.
 *
 * The tail used to be a hardcoded English fragment concatenated in the hook, so
 * a Marathi farmer read one sentence in two scripts. It is i18n now, which
 * means the thing worth asserting HERE is the SHAPE of the sentence — that the
 * phone claim comes first, that both counts come off the enqueue result, that
 * the farmer's language selects the template — and not the wording, which a
 * founder may revise.
 *
 * The wording itself is pinned by hand-written literals in
 * `src/i18n/__tests__/shramSathiVoice.test.ts`, exactly as the three chip
 * labels already are. Pinning it in both places would mean a founder copy edit
 * breaks a dozen behavioural tests that have nothing to say about copy.
 */
const notFiledTail = (language: Language, skipped: number, handled: number): string =>
    translateFormat('sync.notFiledCountTail', language, { skipped, handled });


/** The corrections tail, same reasoning as `notFiledTail`. */
const correctionsTail = (language: Language, count: number): string =>
    translateFormat(
        count === 1 ? 'sync.correctionsFiledTailOne' : 'sync.correctionsFiledTailMany',
        language,
        { count },
    );
/** T1's NEEDS_FIX label. It must NOT appear on this surface — see B3. */
const NEEDS_FIX_MR = 'अडकलं — तपासा';
const NEEDS_FIX_EN = 'Stuck — check';

type ToastCall = { message: string; type: 'success' | 'error' | 'partial' } | null;
type ToastSetter = (toast: ToastCall) => void;
type StatusSetter = (status: AppStatus) => void;
// Structurally `React.Dispatch<React.SetStateAction<LastSavedLogSummaryItem[]>>`,
// spelled out so this test file needs no React type import. Production always
// calls it with a plain array, which is why `lastSummary()` can cast.
type SummarySetter = (
    value: LastSavedLogSummaryItem[] | ((prev: LastSavedLogSummaryItem[]) => LastSavedLogSummaryItem[]),
) => void;

describe('useLogCommands — a save may not claim what was never queued (T2)', () => {
    let setToast: ReturnType<typeof vi.fn<ToastSetter>>;
    let setStatus: ReturnType<typeof vi.fn<StatusSetter>>;
    let setLastSavedLogSummary: ReturnType<typeof vi.fn<SummarySetter>>;

    beforeEach(() => {
        vi.clearAllMocks();
        // Module state (C-1): the registry outlives a test the way it outlives
        // a save, so it has to be cleared like a mock.
        resetUnqueueableLogs();
        langRef.current = 'mr';
        setToast = vi.fn<ToastSetter>();
        setStatus = vi.fn<StatusSetter>();
        setLastSavedLogSummary = vi.fn<SummarySetter>();
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
        setStatus,
        setLastSavedLogSummary,
        setLastSavedLogIds: vi.fn(),
        logIntent: null as null,
        setCurrentRoute: vi.fn(),
        setLastLabourLogIds: vi.fn(),
        ...over,
    });

    const lastToast = (): ToastCall =>
        (setToast.mock.calls.at(-1)?.[0] ?? null) as ToastCall;

    const everyToastMessage = (): string =>
        setToast.mock.calls.map(call => (call[0] as ToastCall)?.message ?? '').join('\n');

    const lastSummary = (): LastSavedLogSummaryItem[] =>
        (setLastSavedLogSummary.mock.calls.at(-1)?.[0] ?? []) as LastSavedLogSummaryItem[];

    // ---------------------------------------------------------------- site 3
    // handleManualSubmit is the ONE path with a live caller today
    // (`mainView.tsx:443` -> ManualEntry's onSubmit).

    it('nothing queued: says the record is on the phone, and uses NO success wording', async () => {
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
            message: `${ON_PHONE_MR} — ${notFiledTail('mr', 3, 3)}`,
            type: 'partial',
        });
        // The specific lie: the old wording, on a save that queued nothing.
        expect(everyToastMessage()).not.toContain('Logged');
        expect(everyToastMessage()).not.toContain('Day closure');
    });

    it('B4: the message leads with the reassurance, so the farmer does not re-record', async () => {
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: ['1'] });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        // Not merely "contains" — it must come FIRST, before any bad news, or a
        // farmer scanning a red toast reads "gone" and records it again.
        expect(lastToast()?.message.startsWith(ON_PHONE_MR)).toBe(true);
    });

    it('B3: it never tells the farmer to go and check, because there is nowhere to check', async () => {
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: ['1'] });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        // A skipped log `continue`s before any mutationQueue row is written, so
        // BackgroundSyncWorker cannot retry it and the sync drawer cannot list
        // it. `तपासा` would point at nothing.
        expect(everyToastMessage()).not.toContain(NEEDS_FIX_MR);
        expect(everyToastMessage()).not.toContain(NEEDS_FIX_EN);
        expect(everyToastMessage()).not.toContain('तपासा');
    });

    it('partially queued: reports the dropped count, and never rounds it up', async () => {
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
            message: `${ON_PHONE_MR} — ${notFiledTail('mr', 2, 3)}`,
            type: 'partial',
        });
        // Rounding two dropped records up into the saved figure is the exact
        // `P4` violation this task removes.
        expect(lastToast()?.message).not.toContain('3 of 3');
    });

    it('a partly-skipped save is never dressed as a failure', async () => {
        // The damage this prevents: a red panel with an X over a record that IS
        // in the local ledger. A red toast is read before its words are, and a
        // farmer who reads "gone" records the day again — leaving two copies.
        // `'error'` is reserved for something that actually failed; nothing
        // failed here, some of it simply has nowhere to be sent.
        //
        // It also buys the message its reading time: `ActionToast` gives
        // `'partial'` 7000ms where `'error'` and `'success'` get 3000.
        createFromManual.mockResolvedValue([makeLog('1'), makeLog('2')]);
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: ['1'], skippedLogIds: ['2'] });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(lastToast()?.type).toBe('partial');
        expect(lastToast()?.type).not.toBe('error');
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
            message: `${ON_PHONE_EN} — ${notFiledTail('en', 1, 1)}`,
            type: 'partial',
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

    // ------------------------------------------------- B1: the durable surface

    it('B1: a skipped CREATE still shows the ledger screen — its record IS in the ledger', async () => {
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: ['1'] });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        // Deliberate, and locked so nobody "fixes" it into a duplicate-record
        // bug: dropping to 'idle' here returns the farmer to a populated form.
        // `confirmAndSave` really did write this log to `db.logs`, so
        // "Saved to Ledger" is true; what the screen must ALSO say is that it is
        // not going anywhere, and that rides on `syncQueued` below.
        expect(setStatus).toHaveBeenCalledWith('success');
    });

    it('B1: the durable screen is handed the per-log sync truth, not just the toast', async () => {
        createFromManual.mockResolvedValue([makeLog('1'), makeLog('2'), makeLog('3')]);
        enqueueLogsForSync.mockResolvedValue({
            queuedLogIds: ['1'],
            skippedLogIds: ['2', '3'],
        });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        // The toast dies after 3000ms; this list feeds the panel that does not.
        // Per-log, because one broadcast can queue one plot and drop another.
        expect(lastSummary().map(item => [item.logId, item.syncQueued])).toEqual([
            ['1', true],
            ['2', false],
            ['3', false],
        ]);
    });

    it('B1: demo mode records NO claim on the summary, rather than a false one', async () => {
        const { result } = renderHook(() => useLogCommands(props({ isDemoMode: true })));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        // `null`, not `false`: no enqueue was attempted, so there is no evidence
        // in either direction. Same discipline as T1's `SyncHonestyClaim`.
        expect(lastSummary().map(item => item.syncQueued)).toEqual([null]);
    });

    // ------------------------------------------------- C-1: the header chip
    // The save path is the ONLY place in the app that ever holds "this record
    // reached no queue". Everything downstream of it — including the sticky
    // header chip, which was still rendering `पाठवलं ✓` over exactly these
    // records — depends on it saying so.

    it('C-1: a skipped save tells the chip, so the header cannot keep claiming Sent', async () => {
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: ['1'] });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(getUnqueueableLogCount()).toBe(1);
        // What the farmer's own device would now derive. `acknowledgedCount` is
        // deliberately high: `APPLIED` rows are never pruned, so any device that
        // has ever synced satisfies the old ON_SERVER condition permanently, and
        // this is the input on which the chip used to contradict the panel
        // directly beneath it.
        expect(deriveSyncHonestyState({
            ...EMPTY_SYNC_EVIDENCE,
            acknowledgedCount: 42,
            unqueueableCount: getUnqueueableLogCount(),
        })).toBe('ON_PHONE');
    });

    it('C-1: a partly-skipped save reports exactly the dropped ones', async () => {
        createFromManual.mockResolvedValue([makeLog('1'), makeLog('2'), makeLog('3')]);
        enqueueLogsForSync.mockResolvedValue({
            queuedLogIds: ['1'],
            skippedLogIds: ['2', '3'],
        });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(getUnqueueableLogCount()).toBe(2);
    });

    it('C-1: a fully-queued save leaves the chip alone', async () => {
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: ['1'], skippedLogIds: [] });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(getUnqueueableLogCount()).toBe(0);
        expect(deriveSyncHonestyState({
            ...EMPTY_SYNC_EVIDENCE,
            acknowledgedCount: 42,
            unqueueableCount: getUnqueueableLogCount(),
        })).toBe('ON_SERVER');
    });

    it('C-1: demo mode reports nothing, because it enqueues nothing', async () => {
        const { result } = renderHook(() => useLogCommands(props({ isDemoMode: true })));
        await act(async () => {
            await result.current.handleManualSubmit({ cropActivities: [] });
        });

        expect(enqueueLogsForSync).not.toHaveBeenCalled();
        expect(getUnqueueableLogCount()).toBe(0);
    });

    it('C-1: every save path reports, not just the one with a live caller', async () => {
        // `handleAutoSave`, `handleFinalConfirm` and `handleWizardSubmit` have no
        // caller today, but all four share one enqueue seam precisely so a
        // future caller cannot inherit a silent drop.
        const paths: Array<() => Promise<void>> = [];
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: ['1'] });

        const { result } = renderHook(() => useLogCommands(props()));
        paths.push(() => result.current.handleAutoSave({ summary: 'x' } as never));
        paths.push(() => result.current.handleFinalConfirm({ summary: 'x' } as never, null));
        paths.push(() => result.current.handleWizardSubmit([makeLog('1')] as never));
        paths.push(() => result.current.handleManualSubmit({ cropActivities: [] }));

        for (const run of paths) {
            resetUnqueueableLogs();
            await act(async () => {
                await run();
            });
            expect(getUnqueueableLogCount()).toBe(1);
        }
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
            message: `${ON_PHONE_MR} — ${notFiledTail('mr', 3, 3)}`,
            type: 'partial',
        });
        expect(everyToastMessage()).not.toContain('Saved to');
    });

    it('handleWizardSubmit: an all-queued broadcast keeps its existing wording', async () => {
        // Retitled in review round 1. This is a happy-path REGRESSION guard, not
        // a proof that the count derives from the queued result: the failure
        // branch takes over whenever anything is skipped, so `queuedLogIds.length`
        // and `logs.length` are structurally equal on every input that can reach
        // this line. The real proof that no submitted-set count survives is the
        // fully-skipped test above.
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

    it('handleAutoSave: a fully-skipped voice save says on-phone, not "Logged."', async () => {
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: ['1'] });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleAutoSave({ summary: 'x' } as never);
        });

        expect(lastToast()).toEqual({
            message: `${ON_PHONE_MR} — ${notFiledTail('mr', 1, 1)}`,
            type: 'partial',
        });
    });

    it('handleFinalConfirm: a fully-skipped confirm says on-phone, not "Logged."', async () => {
        enqueueLogsForSync.mockResolvedValue({ queuedLogIds: [], skippedLogIds: ['1'] });

        const { result } = renderHook(() => useLogCommands(props()));
        await act(async () => {
            await result.current.handleFinalConfirm({ summary: 'x' } as never, null);
        });

        expect(lastToast()).toEqual({
            message: `${ON_PHONE_MR} — ${notFiledTail('mr', 1, 1)}`,
            type: 'partial',
        });
    });
});

// ---------------------------------------------------------------------- site 5
describe('useLogCommands — the EDIT path may not claim a save it cannot evidence (T2 §3b)', () => {
    let setToast: ReturnType<typeof vi.fn<ToastSetter>>;
    let setStatus: ReturnType<typeof vi.fn<StatusSetter>>;

    beforeEach(() => {
        vi.clearAllMocks();
        resetUnqueueableLogs();
        langRef.current = 'mr';
        setToast = vi.fn<ToastSetter>();
        setStatus = vi.fn<StatusSetter>();
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
        setStatus,
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

    // -------------------------------------------------------- PHASE 4 / R19
    //
    // WHAT WAS DELETED HERE, AND WHY THE DELETION IS THE FIX.
    //
    // Seven tests used to live in this block pinning the sentence
    // "…shown on screen only — not saved anywhere." on both edit branches, plus
    // its `'partial'` toast type. Every one of them was correct when written:
    // `updateLog` called `repo.getById` and never `repo.save`, `setHistory` is
    // React state with no persist subscriber, and the edit really did die on the
    // next reload. They were a truthful description of a missing feature.
    //
    // Phase 4 built the feature (§A7.1). The moment `updateLog` persisted, that
    // sentence became false in the OTHER direction — telling a farmer their
    // saved record was not saved, which teaches them to distrust a correction
    // that worked and to enter it again. Re-wording those tests to keep the
    // sentence alive would have preserved the lie; they are removed together
    // with the string, by the controller's standing ruling R19.
    //
    // WHAT IS NOT DELETED, because it never depended on that sentence: the edit
    // path still refuses the full-screen "Saved to Ledger" panel, and the tests
    // below still pin that — now for the reason stated at
    // `useLogCommands.ts`'s `showSavedToLedgerPanel`, which is about the panel
    // being create-shaped rather than about nothing being written.

    it('an edit is reported as saved on the phone, because now it is', async () => {
        updateLog.mockResolvedValue({
            success: true,
            log: makeLog('1'),
            persistedLabourCorrections: 0,
        });

        await submitEdit();

        expect(setToast).toHaveBeenCalledWith({ message: ON_PHONE_MR, type: 'success' });
    });

    it('the deleted claim never comes back: no edit toast says the edit is not saved', async () => {
        // The R19 guard. Both branches, both languages, in the words the old
        // sentence used — if any of them reappears on a path that now persists,
        // this fails.
        for (const persisted of [0, 1, 3]) {
            vi.clearAllMocks();
            setToast = vi.fn<ToastSetter>();
            updateLog.mockResolvedValue({
                success: true,
                log: makeLog('1'),
                persistedLabourCorrections: persisted,
            });

            await submitEdit();

            const message = (setToast.mock.calls.at(-1)?.[0] as ToastCall)?.message ?? '';
            expect(message.toLowerCase()).not.toContain('shown on screen only');
            expect(message.toLowerCase()).not.toContain('not saved anywhere');
            expect(message.toLowerCase()).not.toContain('not saved');
        }
    });

    it('the edit toast speaks the SAME on-phone words as the create path, in both languages', async () => {
        // `R6` — one claim, one string. The chip, the skipped-create toast and
        // now the edit toast all resolve `sync.onPhone` through the real i18n
        // table, so a copy change lands on all three or on none.
        for (const [language, expected] of [['mr', ON_PHONE_MR], ['en', ON_PHONE_EN]] as const) {
            vi.clearAllMocks();
            setToast = vi.fn<ToastSetter>();
            langRef.current = language;
            updateLog.mockResolvedValue({
                success: true,
                log: makeLog('1'),
                persistedLabourCorrections: 0,
            });

            await submitEdit();

            expect((setToast.mock.calls.at(-1)?.[0] as ToastCall)?.message).toBe(expected);
        }
    });

    it('an edit NEVER shows the "Saved to Ledger" screen, whatever the outcome', async () => {
        // The reason changed in Phase 4; the answer did not. The panel is
        // create-shaped — a "Stored In" card, a bucket breakdown of what the log
        // CONTAINS, and a `syncQueued` badge derived from an enqueue this path
        // never performs — so it would answer a question the farmer did not ask
        // and evidence a sync claim it has no evidence for.
        for (const persisted of [0, 2]) {
            vi.clearAllMocks();
            setStatus = vi.fn<StatusSetter>();
            setToast = vi.fn<ToastSetter>();
            updateLog.mockResolvedValue({
                success: true,
                log: makeLog('1'),
                persistedLabourCorrections: persisted,
            });

            await submitEdit();

            expect(setStatus).not.toHaveBeenCalledWith('success');
            expect(setStatus).toHaveBeenCalledWith('idle');
        }
    });

    it('an edit whose labour corrections the server accepted names that, beside the phone claim', async () => {
        updateLog.mockResolvedValue({
            success: true,
            log: makeLog('1'),
            persistedLabourCorrections: 2,
        });

        await submitEdit();

        expect(setToast).toHaveBeenCalledWith({
            message: `${ON_PHONE_MR} — ${correctionsTail('mr', 2)}`,
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
            message: `${ON_PHONE_MR} — ${correctionsTail('mr', 1)}`,
            type: 'success',
        });
    });

    it('makes no server claim when nothing was sent — an absence is not news', async () => {
        // `P4` cuts both ways. A farmer who corrected an irrigation figure sent
        // nothing because there was nothing labour-shaped to send; announcing
        // that absence would be a nag on the correction path (`P9`). The message
        // stops at the claim it can evidence.
        updateLog.mockResolvedValue({
            success: true,
            log: makeLog('1'),
            persistedLabourCorrections: 0,
        });

        await submitEdit();

        const message = (setToast.mock.calls.at(-1)?.[0] as ToastCall)?.message ?? '';
        expect(message).not.toContain('server');
        expect(message).not.toContain('correction');
    });

    it('an older result with no evidence field at all is treated as no evidence', async () => {
        // Defends the `?? 0`: absence must never be read as a server acceptance.
        updateLog.mockResolvedValue({ success: true, log: makeLog('1') });

        await submitEdit();

        expect(setToast).toHaveBeenCalledWith({ message: ON_PHONE_MR, type: 'success' });
    });

    it('a FAILED edit still says nothing was saved, and never enters success', async () => {
        // The one path where "not saved" is still true. `updateLog` returns
        // `success: false` when the correction was refused or `repo.save` threw,
        // and the caller must not soften that into an on-phone claim.
        updateLog.mockResolvedValue({ success: false, error: 'Request failed with status code 403' });

        await submitEdit();

        expect(setToast).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'success' }),
        );
        expect(setStatus).not.toHaveBeenCalledWith('success');
    });
});
