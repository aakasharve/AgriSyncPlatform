import { useCallback, useMemo } from 'react';
import {
    AgriLogResponse, LogScope, CropProfile, FarmerProfile, DailyLog,
    InputMode, PageView, AppStatus, AppRoute, PlannedTask
} from '../../types';
import { LogProvenance } from '../../domain/ai/LogProvenance';
import { logger } from '../../infrastructure/observability/Logger';
import { CorrelationId } from '../../infrastructure/observability/CorrelationContext';
import { WeatherPort } from '../../application/ports/WeatherPort';
import { computeDayState } from '../../shared/utils/dayState';
import type { LastSavedLogSummaryItem } from '../uiRuntimeTypes';
import type { LogIntent } from './useAppNavigation';

// ARCHITECTURE FIX: Import Service Class and Hook
import { LogCommandServiceImpl } from '../../application/services/LogCommandService';
import { useDataSource } from '../providers/DataSourceProvider';
import { enqueueLogsForSync } from '../../features/logs/services/logSyncMutationService';
import { countCompletedIrrigationEvents } from '../../features/logs/services/irrigationCompletion';
// Labour Phase 2 / T2 — a record that never reached the sync queue is still ON
// THE PHONE, and it is described with the SAME words the header chip uses for
// that situation (T1's `sync.onPhone`). Two surfaces, one claim, one string.
//
// Deep import rather than the `features/sync` barrel deliberately: that barrel
// also re-exports `SyncStatusDrawer`, which pulls `lucide-react`, `getDatabase`
// and the `backgroundSyncWorker` singleton (instantiated at module scope,
// `BackgroundSyncWorker.ts:274`) into this hook's module graph — a UI drawer and
// a live sync worker imported for one string constant. `SyncStatusService.ts`
// already deep-imports this exact module for the same reason.
import { SYNC_HONESTY_I18N_KEYS } from '../../features/sync/status/syncHonestyState';
// Final fix round, finding C-1 — the header chip is the ONE surface that stayed
// wrong. It derives its claim from `db.mutationQueue`, and a skipped log writes
// no row there, so on any device that has ever had a mutation applied
// (`APPLIED` rows are never pruned) the chip kept rendering `पाठवलं ✓` directly
// above a panel badge reading `फोनवर सेव्ह ✓ — cannot be sent`, about the record
// the farmer had just created. This is the only place in the app that ever holds
// that fact, so this is the only place that can tell it.
import { noteUnqueueableLogs } from '../../features/sync/status/unqueueableLogs';
import { useLanguage } from '../../i18n/LanguageContext';
import { t as translate, type Language } from '../../i18n/translations';

export interface UseLogCommandsResult {
    handleAutoSave: (logData: AgriLogResponse, provenance?: LogProvenance) => Promise<void>;
    handleFinalConfirm: (editedData: AgriLogResponse | null, draftLog: AgriLogResponse | null) => Promise<void>;
    // Pre-existing `any` (predates Task 3.5; tracked project-wide by
    // Sub-plan 04 Task 10 per eslint.config.js) — not introduced by this
    // change, left as-is to avoid retyping the ManualEntry payload contract
    // out of scope.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleManualSubmit: (data: any) => Promise<void>;
    handleWizardSubmit: (logs: DailyLog[]) => Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleUpdateNote: (logId: string, noteId: string, updates: any) => void;
    // Exposed for testing/advanced usage
    service: LogCommandServiceImpl;
}

interface UseLogCommandsProps {
    hasActiveLogContext: boolean;
    logScope: LogScope;
    setLogScope: (scope: LogScope) => void;
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    history: DailyLog[];
    plannedTasks: PlannedTask[];
    isDemoMode: boolean; // Kept for logic checks if needed, but persistence is agnostic
    // Unified History Setter
    setHistory: React.Dispatch<React.SetStateAction<DailyLog[]>>;

    // Deprecated setters (ignored in new logic but kept for prop compatibility if not updated in parent)
    // Pre-existing `any` (predates Task 3.5) — see note on handleManualSubmit above.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    setMockHistory?: any;
    setRealHistory?: any;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    setPlannedTasks: React.Dispatch<React.SetStateAction<PlannedTask[]>>;
    setToast: (toast: { message: string; type: 'success' | 'error' | 'partial' } | null) => void;
    setError: (msg: string | null) => void;
    setDraftLog: (log: AgriLogResponse | null) => void;
    // Pre-existing `any` (predates Task 3.5) — see note on handleManualSubmit above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setRecordingSegment: (seg: any) => void;
    setMode: (mode: InputMode) => void;
    setMainView: (view: PageView) => void;
    setStatus: (status: AppStatus) => void;
    setLastSavedLogSummary: React.Dispatch<React.SetStateAction<LastSavedLogSummaryItem[]>>;
    setLastSavedLogIds: React.Dispatch<React.SetStateAction<string[]>>;
    weatherProvider?: WeatherPort;

    // spec: 2026-07-13-labour-attendance-approval-design (Task 3.5) — when a
    // log is saved while the farmer arrived via the labour mic, route them
    // back to Labour Management instead of the generic "Saved to Ledger"
    // screen, and record which log(s) were saved so that page can show a
    // labour-only summary of what was just logged.
    logIntent: LogIntent;
    setCurrentRoute: (route: AppRoute) => void;
    setLastLabourLogIds: (ids: string[]) => void;
}

/**
 * What `enqueueLogsForSync` hands back. Derived from the function rather than
 * re-declared, because `logSyncMutationService.ts` is owned by a later phase
 * and must not gain a single line for this task (STOP condition S3).
 */
type LogSyncEnqueueOutcome = Awaited<ReturnType<typeof enqueueLogsForSync>>;

type SaveToast = { message: string; type: 'success' | 'error' | 'partial' };

/**
 * Labour Phase 2 / T2 — the honest toast for a save whose records did NOT all
 * reach the sync queue.
 *
 * WHY THIS EXISTS. `enqueueLogsForSync` has always returned `skippedLogIds` —
 * the logs it could not queue, because `resolveSyncTarget` found no plot or no
 * crop cycle for them. Until this task that array had zero production
 * consumers: all four call sites discarded the whole result and fired a success
 * toast unconditionally. So the exact records the app already KNEW it had
 * dropped were the records the farmer was told were saved. A farmer picking
 * "संपूर्ण शेत" recorded eight workers, read `Logged.`, and the record never
 * left the handset. Doctrine `P4` (no fabricated figure reaches a farmer) and
 * `P5` (a truthful missing feature beats a fake working one).
 *
 * THE COUNTS COME FROM THE QUEUED RESULT, NEVER FROM THE SUBMITTED SET. Both
 * the numerator and the denominator are read off the outcome object, so a
 * message can never round a skipped log up into a saved one.
 *
 * Returns `null` when there is nothing to confess — that is the caller's signal
 * that its own existing success wording is legitimate, so the happy path is
 * byte-identical to before.
 *
 * IT LEADS WITH `ON_PHONE`, NOT `NEEDS_FIX` (review round 1, findings B3+B4).
 * The first version ended on T1's `अडकलं — तपासा` / `Stuck — check`, and that
 * was wrong twice over:
 *
 *   - `तपासा` means "go and check", and there is nowhere to go. A skipped log
 *     `continue`s before any queue row is written (`logSyncMutationService.ts:324-327`),
 *     so `BackgroundSyncWorker` will never retry it and the sync drawer cannot
 *     list it. Sending a farmer to look for something with no home in the state
 *     model is a second lie stacked on the first.
 *   - A red icon over `0 of 1` reads as "your record is GONE", so the farmer
 *     re-records it — and now there are two. The record is genuinely safe on the
 *     handset; `confirmAndSave` wrote it to `db.logs` before the enqueue was
 *     even attempted. Not saying so causes the duplicate.
 *
 * So it leads with T1's `sync.onPhone` (`फोनवर सेव्ह ✓` / `Saved on phone`) —
 * the reassurance, first, in the farmer's own language via the app's i18n
 * (`R6`) — and then states the news plainly. "cannot be sent", not "not yet":
 * as the code stands today no path will ever pick these up, and a false promise
 * of a retry is the same class of defect this task exists to remove.
 *
 * THE COUNT IS `skippedLogIds.length` — read off the enqueue result, never off
 * `logs.length`. It is the number that carries the news, and it cannot round a
 * dropped record up into a saved one: a partial save reads `2 of 3`, never
 * `3 of 3`.
 *
 * Reason-agnostic by design (architect Overlap C): `resolveSyncTarget` has two
 * failure causes, Phase 2 removes the dominant one, and naming a cause would
 * cost a copy rewrite and a re-test on a message that is about to change.
 *
 * NOT COVERED, STATED PLAINLY: a log lost to a THROW out of
 * `MutationQueue.enqueue` is invisible here — `skippedLogIds` structurally
 * cannot see it, and that path already surfaces an honest "Failed to save logs"
 * through the caller's catch. Controller ruling `R4` leaves it alone; Phase 2b
 * removes multi-log batches and it self-resolves.
 */
function skippedSyncToast(
    outcome: LogSyncEnqueueOutcome | null,
    language: Language,
): SaveToast | null {
    // `null` = no enqueue was attempted at all (demo mode), so there is no
    // sync claim to make either way and the local save wording stands.
    if (!outcome || outcome.skippedLogIds.length === 0) {
        return null;
    }

    const skipped = outcome.skippedLogIds.length;
    const handled = outcome.queuedLogIds.length + skipped;

    return {
        message: `${translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, language)} — ${skipped} of ${handled} cannot be sent.`,
        // `'partial'`, not `'error'`. Round 0 shipped red because a record that
        // will never reach the server is a real incompleteness, and argued that
        // the leading `फोनवर सेव्ह ✓` answered the "it is gone" misreading. It
        // does not answer it well enough: a red panel with an X is read before
        // any words are, and a farmer who reads "gone" re-records — leaving two
        // copies of one day's work in the ledger. The message is unchanged; the
        // alarm around it is now proportionate to what actually happened, and it
        // stays up for 7s instead of 3 because it says more than "Logged." did.
        type: 'partial',
    };
}

export const useLogCommands = ({
    hasActiveLogContext,
    logScope,
    setLogScope,
    crops,
    farmerProfile,
    history,
    plannedTasks,
    isDemoMode,
    setHistory,
    setPlannedTasks,
    setToast,
    setError,
    setDraftLog,
    setRecordingSegment,
    setMode,
    setMainView,
    setStatus,
    setLastSavedLogSummary,
    setLastSavedLogIds,
    weatherProvider,
    logIntent,
    setCurrentRoute,
    setLastLabourLogIds
}: UseLogCommandsProps): UseLogCommandsResult => {

    // --- DATA SOURCE & SERVICE ---
    const { dataSource } = useDataSource();

    // Labour Phase 2 / T2 — `language`, not `t`. `LanguageProvider` rebuilds its
    // `t` on every render (`LanguageContext.tsx:31`), so putting `t` in the
    // dependency arrays below would recreate all four save callbacks on every
    // ancestor render, and leaving it OUT would strand them on a stale language.
    // A plain string dep has neither problem.
    //
    // Safe to call here: `useLogCommands` is reached only through
    // `compositionRoot.useAgriLogApp` -> `AppContent`, which mounts inside
    // `<LanguageProvider>` (`App.tsx:133`). The two provider-free early returns
    // (`App.tsx:124-125`, the ops and labour previews) never render `AppContent`.
    const { language } = useLanguage();

    const logCommandService = useMemo(() => {
        return new LogCommandServiceImpl(dataSource.logs, weatherProvider);
    }, [dataSource.logs, weatherProvider]);

    // --- HELPER: CALCULATE SUMMARY ---
    // Labour Phase 2 / T2 (review round 1, finding B1) — the enqueue outcome now
    // travels with the summary. This is the DURABLE half of the truth: the toast
    // that reports a skipped log dies after 3000ms (`ActionToast.tsx:16`), while
    // the "Saved to Ledger" screen this summary feeds (`mainView.tsx:600`)
    // persists until the farmer navigates away. Without this, the reassuring
    // half of the story outlives the honest half on the exact path this task
    // exists to fix. `null` outcome (demo mode) means NO claim, not `false`.
    const calculateLogSummary = (logs: DailyLog[], syncOutcome: LogSyncEnqueueOutcome | null) => {
        const queuedIds = syncOutcome ? new Set(syncOutcome.queuedLogIds) : null;
        const summary: LastSavedLogSummaryItem[] = logs.map(log => {
            const selection = log.context.selection[0];
            const contextCropId = selection?.cropId;
            const cropName = contextCropId === 'FARM_GLOBAL'
                ? 'Farm'
                : crops.find(c => c.id === contextCropId)?.name || 'Unknown Crop';
            const plotId = selection?.selectedPlotIds?.[0];
            const plotName = selection?.selectedPlotNames?.[0]
                || crops
                    .find(crop => crop.id === contextCropId)
                    ?.plots.find(plot => plot.id === plotId)
                    ?.name
                || 'Farm';

            const count = (log.cropActivities?.length || 0) +
                (log.labour?.length || 0) +
                (log.inputs?.length || 0) +
                (log.machinery?.length || 0) +
                countCompletedIrrigationEvents(log.irrigation || []);

            return {
                logId: log.id,
                cropId: contextCropId,
                cropName,
                plotId,
                plotName,
                count,
                syncQueued: queuedIds ? queuedIds.has(log.id) : null,
            };
        });
        setLastSavedLogSummary(summary);
    };

    /**
     * Enqueue, and tell the chip about anything that could not be enqueued.
     *
     * ONE seam instead of four (finding C-1). Every save site already had the
     * identical `isDemoMode ? null : await enqueueLogsForSync(...)` line; folding
     * the note into it means a fifth save path cannot be added that drops a
     * record silently while the header still says `पाठवलं ✓`. `skippedLogIds`
     * now has TWO consumers — the toast the farmer reads once, and the chip they
     * see for the rest of the session.
     *
     * Demo mode returns `null` exactly as before: nothing is enqueued, so there
     * is nothing skipped and no claim to weaken.
     *
     * `isDemoMode` is read from the enclosing render's closure, which is
     * precisely where the four callbacks read it today (it has never been in
     * their dependency arrays — pre-existing, documented at each one). Same
     * closure, same value, no change in memoization behaviour.
     */
    const enqueueForSyncAndNoteSkips = async (
        logs: DailyLog[],
    ): Promise<LogSyncEnqueueOutcome | null> => {
        if (isDemoMode) {
            return null;
        }

        const outcome = await enqueueLogsForSync(logs);
        noteUnqueueableLogs(outcome.skippedLogIds);
        return outcome;
    };

    const computeClosureDelta = useCallback((beforeLogs: DailyLog[], afterLogs: DailyLog[]) => {
        const beforePercent = computeDayState({
            logs: beforeLogs,
            crops,
            tasks: plannedTasks
        }).closurePercent;
        const afterPercent = computeDayState({
            logs: afterLogs,
            crops,
            tasks: plannedTasks
        }).closurePercent;
        return { beforePercent, afterPercent };
    }, [crops, plannedTasks]);

    // --- AUTO SAVE ---
    const handleAutoSave = useCallback(async (logData: AgriLogResponse, provenance?: LogProvenance) => {

        // PHASE 25: Context Switching & Global Voice
        let effectiveScope = logScope;

        if (logData.suggestedContext) {
            const { cropId, plotId } = logData.suggestedContext;
            if (cropId && plotId) {
                // Construct new scope for the log
                effectiveScope = {
                    mode: 'single',
                    selectedCropIds: [cropId],
                    selectedPlotIds: [plotId],
                    applyPolicy: 'broadcast'
                };

                // Switch UI context seamlessly
                setLogScope(effectiveScope);
                logger.info('Context auto-switched via Voice', { cropId, plotId });
            }
        }

        // Safety check: Must have effective scope or active context
        if (!hasActiveLogContext && !logData.suggestedContext) {
            logger.warn("Auto-save blocked: No context");
            return;
        }

        const correlationId = CorrelationId.generate();
        logger.info('Auto-save started', { correlationId, summary: logData.summary });

        try {
            // SINGLE WRITE PATH: Delegate to Service
            const newLogs = await logCommandService.createFromVoice(
                logData,
                effectiveScope,
                crops,
                farmerProfile,
                provenance
            );

            // Persist (Service handles persistence via injected repo)
            await logCommandService.confirmAndSave(
                newLogs,
                setHistory // Update UI
            );
            // T2 — the result is EVIDENCE, not noise. `null` in demo mode,
            // where nothing is meant to reach a server at all.
            const syncOutcome = await enqueueForSyncAndNoteSkips(newLogs);

            // Sync: Extract and add any planned tasks from the new logs to global state
            const newTasks = newLogs.flatMap(l => l.plannedTasks || []);
            if (newTasks.length > 0) {
                setPlannedTasks(prev => mergeUniqueTasks(prev, newTasks));
            }

            // Calculate Summary for Feedback
            calculateLogSummary(newLogs, syncOutcome);
            setLastSavedLogIds(newLogs.map(l => l.id));

            const { beforePercent, afterPercent } = computeClosureDelta(
                history,
                [...newLogs, ...history]
            );

            // AUTO-SAVE SUCCESS: Show the success screen instead of just a toast
            setToast(skippedSyncToast(syncOutcome, language) ?? {
                message: `Logged. Day closure: ${beforePercent}% -> ${afterPercent}%`,
                type: 'success'
            });
            setStatus('success');
            setMode('manual'); // Ensure we are in a view that shows the success state overlay

            logger.info('Auto-save completed', { correlationId });
        } catch (e) {
            logger.error("Auto-save error", e, { correlationId });
            setToast({ message: "Failed to auto-save", type: 'error' });
            setError("Failed to auto-save. Please check your connection.");
        }
        // Pre-existing exhaustive-deps gap (predates Task 3.5; calculateLogSummary
        // and isDemoMode are used but not listed) — not introduced by this
        // change; not touched to avoid altering this callback's memoization
        // behavior for handleAutoSave, which has no caller in the app today.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasActiveLogContext, logScope, crops, farmerProfile, logCommandService, setHistory, setPlannedTasks, setToast, setStatus, setMode, setLastSavedLogSummary, setLastSavedLogIds, setError, computeClosureDelta, history, setLogScope, language]);

    // --- FINAL CONFIRM ---
    const handleFinalConfirm = useCallback(async (editedData: AgriLogResponse | null, draftLog: AgriLogResponse | null) => {
        const finalLog = editedData || draftLog;
        if (!finalLog || !hasActiveLogContext) return; // SAFE GUARD

        const correlationId = CorrelationId.generate();
        logger.info('Final confirm started', { correlationId });

        try {
            // SINGLE WRITE PATH: Delegate to Service
            const newLogs = await logCommandService.createFromVoice(
                finalLog,
                logScope,
                crops,
                farmerProfile,
                // Provenance might be lost here if we don't pass it from draft, 
                // but usually draft has it in meta. For now, undefined new provenance.
            );

            // Persist
            await logCommandService.confirmAndSave(
                newLogs,
                setHistory
            );
            // T2 — see handleAutoSave: the enqueue result decides the wording.
            const syncOutcome = await enqueueForSyncAndNoteSkips(newLogs);

            // Sync: Extract and add any planned tasks from the new logs to global state
            const newCreatedTasks = newLogs.flatMap(l => l.plannedTasks || []);
            if (newCreatedTasks.length > 0) {
                setPlannedTasks(prev => mergeUniqueTasks(prev, newCreatedTasks));
            }

            setDraftLog(null);
            setRecordingSegment(null);

            // Phase 14: Jump to Manual Ledger after confirmation
            // Calculate Summary for Feedback (re-calc for final state)
            calculateLogSummary(newLogs, syncOutcome);
            setLastSavedLogIds(newLogs.map(l => l.id));

            const { beforePercent, afterPercent } = computeClosureDelta(
                history,
                [...newLogs, ...history]
            );
            setToast(skippedSyncToast(syncOutcome, language) ?? {
                message: `Logged. Day closure: ${beforePercent}% -> ${afterPercent}%`,
                type: 'success'
            });

            setMode('manual');
            setMainView('log');

            // Reset status to idle so UI doesn't stay on 'success' screen
            setStatus('idle');
            logger.info('Final confirm completed', { correlationId });
        } catch (e) {
            logger.error("Final confirm error", e, { correlationId });
            setError("Failed to save logs. Please try again.");
        }
        // Pre-existing exhaustive-deps gap (predates Task 3.5) — see note on
        // handleAutoSave above; handleFinalConfirm also has no caller in the
        // app today.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasActiveLogContext, logScope, crops, farmerProfile, logCommandService, setHistory, setPlannedTasks, setDraftLog, setRecordingSegment, setMode, setMainView, setStatus, setError, setLastSavedLogSummary, setLastSavedLogIds, computeClosureDelta, history, setToast, language]);

    // --- MANUAL SUBMIT ---
    // Pre-existing `any` (predates Task 3.5) — see note on handleManualSubmit
    // in UseLogCommandsResult above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleManualSubmit = useCallback(async (data: any) => {
        if (!hasActiveLogContext) return; // SAFE GUARD
        try {
            let savedLogIds: string[];
            // Labour Phase 2 / T2 (review round 1, finding B1) — did this submit
            // write anything to the LOCAL LEDGER? Only the create branch does
            // (`confirmAndSave` -> `repo.batchSave`). The edit branch writes
            // NOWHERE: `updateLog` calls `repo.getById` and never `repo.save`,
            // and `setHistory` is React state with no persist subscriber. That
            // distinction is what decides whether the full-screen
            // "Saved to Ledger" panel (`mainView.tsx:600`) may be shown at all.
            let ledgerWritten: boolean;

            if (data.originalLogId) {
                // --- SECURE UPDATE ---
                // SINGLE WRITE PATH: Delegate to Service
                const result = await logCommandService.updateLog(
                    data.originalLogId,
                    { ...data, id: data.originalLogId },
                    farmerProfile,
                    'Manual Edit via UI'
                );

                if (!result.success) {
                    throw new Error(result.error || 'Update failed');
                }

                // Update local state reflectively
                setHistory(prev => {
                    const filtered = prev.filter(l => l.id !== data.originalLogId);
                    return [result.log as DailyLog, ...filtered];
                });

                // Labour Phase 2 / T2 — THE FIFTH TOAST. This branch never calls
                // `enqueueLogsForSync` at all; queueing for an edit happens
                // inside `application/usecases/UpdateLog.ts`. It used to fire
                // the same `Logged.` success line off `result.success` alone —
                // but `success: true` is also exactly what an edit that
                // persisted NOTHING returns, because only the LABOUR portion of
                // an edit has a server-side path (the Task 12b correction
                // route). Crop activities, irrigation, inputs, machinery and
                // expenses have none, and this use case does not `repo.save`
                // either, so such an edit survives only in React state until the
                // next reload.
                //
                // `persistedLabourCorrections` is the only real evidence
                // available, and it IS a server outcome: `postLabourCorrection`
                // throws on any non-2xx and the throw becomes `success: false`.
                //
                // The zero case is deliberately NOT `NEEDS_FIX`. "अडकलं — तपासा"
                // means the system is stuck and the farmer can act; here there
                // is nothing to retry and nothing to check, because the feature
                // does not exist yet. Claiming otherwise would teach the farmer
                // the app is broken (`P5`). So it says less instead. It also
                // does NOT say "not saved YET": there is no pending write and no
                // scheduled one, and a false promise of eventual saving is the
                // same class of defect as a false claim of saving. Phase 4 owns
                // the real fix; revisit this wording when it lands.
                //
                // Nor does it borrow `sync.onPhone`: unlike a skipped CREATE,
                // this edit is not on the phone either. `setHistory` is React
                // state and nothing persists it.
                const persistedCorrections = result.persistedLabourCorrections ?? 0;
                setToast(persistedCorrections > 0
                    ? {
                        message: `${persistedCorrections} labour correction${persistedCorrections === 1 ? '' : 's'} sent to the server.`,
                        type: 'success'
                    }
                    : {
                        // `'partial'`, not `'error'` — for the same reason as the
                        // skipped-save toast, and one more: NOTHING FAILED here.
                        // Red says "it broke, try again", and there is nothing to
                        // try again; the edit path has no persistence yet (Phase
                        // 4 owns that). A truthful missing feature must not be
                        // dressed as a fault (`P5`). It also gets the longer 7s
                        // window, because this sentence is the ONLY confirmation
                        // the edit path has — a judgement the controller reviewed
                        // and accepted rather than adding a confirmation panel
                        // over a path that writes to no ledger.
                        message: 'Shown on screen only — this edit is not saved anywhere.',
                        type: 'partial'
                    });
                savedLogIds = [(result.log as DailyLog).id];
                ledgerWritten = false;

            } else {
                // --- CREATE NEW ---
                // SINGLE WRITE PATH: Delegate to Service
                const newLogs = await logCommandService.createFromManual(
                    data,
                    logScope,
                    crops,
                    farmerProfile
                );

                await logCommandService.confirmAndSave(
                    newLogs,
                    setHistory
                );
                // T2 — see handleAutoSave: the enqueue result decides the wording.
                const syncOutcome = await enqueueForSyncAndNoteSkips(newLogs);

                // Sync
                const manualTasks = newLogs.flatMap(l => l.plannedTasks || []);
                if (manualTasks.length > 0) {
                    setPlannedTasks(prev => mergeUniqueTasks(prev, manualTasks));
                }

                calculateLogSummary(newLogs, syncOutcome);
                setLastSavedLogIds(newLogs.map(l => l.id));

                const nextHistory = [...newLogs, ...history];
                const { beforePercent, afterPercent } = computeClosureDelta(history, nextHistory);
                setToast(skippedSyncToast(syncOutcome, language) ?? {
                    message: `Logged. Day closure: ${beforePercent}% -> ${afterPercent}%`,
                    type: 'success'
                });
                savedLogIds = newLogs.map(l => l.id);
                ledgerWritten = true;
            }

            // spec: 2026-07-13-labour-attendance-approval-design (Task 3.5) —
            // a log saved while the farmer arrived via the labour mic
            // (logIntent === 'labour') returns them straight to Labour
            // Management instead of the generic "Saved to Ledger" screen.
            // lastLabourLogIds lets that page render a labour-only summary
            // of what was just logged — computed there via the SAME
            // generateDayWorkSummary(...).labour the reflect page uses, so
            // the numbers can never fork between the two screens.
            if (logIntent === 'labour') {
                setLastLabourLogIds(savedLogIds);
                setStatus('idle');
                setCurrentRoute('labour');
            } else {
                // Labour Phase 2 / T2 (review round 1, finding B1) — `'success'`
                // is not a mood, it is the trigger for a full-screen
                // "Saved to Ledger" panel that persists until the farmer
                // navigates away, long after the 3000ms toast has gone
                // (`ActionToast.tsx:16`). An EDIT wrote to no ledger at all, so
                // entering that state would leave the longest-lived surface in
                // the flow making the one claim that is flatly false.
                //
                // A skipped CREATE keeps `'success'` on purpose. Its record IS
                // in the local ledger, so the panel's headline is true; what is
                // false there is only the implied "and it is on its way", and
                // the fix for that is the per-log `syncQueued` flag now carried
                // on `lastSavedLogSummary` (rendered by `mainView.tsx`, batched
                // into the L5b run) — NOT dropping to `'idle'`, which would
                // return the farmer to a populated form and invite a duplicate
                // record. Wrong trade: a soft contradiction is not worth a real
                // double-entry.
                setStatus(ledgerWritten ? 'success' : 'idle');
            }
        } catch (e) {
            console.error("Critical error in handleManualSubmit:", e);
            setError("Failed to save logs. Please try again.");
        }
        // Pre-existing exhaustive-deps gap (predates Task 3.5; calculateLogSummary
        // and isDemoMode were already missing before this change) — Task 3.5
        // only added logIntent/setCurrentRoute/setLastLabourLogIds to this
        // array. Not widened further: calculateLogSummary is a plain,
        // unmemoized closure recreated every render, so adding it here would
        // make this callback lose its memoization on every render — a
        // separate, deliberate fix, not a byproduct of this task.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasActiveLogContext, logScope, crops, farmerProfile, logCommandService, setHistory, setPlannedTasks, setStatus, setError, setLastSavedLogSummary, setLastSavedLogIds, computeClosureDelta, history, setToast, logIntent, setCurrentRoute, setLastLabourLogIds, language]);

    const handleWizardSubmit = useCallback(async (logs: DailyLog[]) => {
        if (logs.length === 0) {
            setError('No plots selected for this log.');
            return;
        }

        try {
            await logCommandService.confirmAndSave(logs, setHistory);
            // T2 — see handleAutoSave: the enqueue result decides the wording.
            const syncOutcome = await enqueueForSyncAndNoteSkips(logs);

            const wizardTasks = logs.flatMap(log => log.plannedTasks || []);
            if (wizardTasks.length > 0) {
                setPlannedTasks(prev => mergeUniqueTasks(prev, wizardTasks));
            }

            calculateLogSummary(logs, syncOutcome);
            setLastSavedLogIds(logs.map(log => log.id));

            const nextHistory = [...logs, ...history];
            const { beforePercent, afterPercent } = computeClosureDelta(history, nextHistory);
            // T2 — `logs.length` was the SUBMITTED count. With two of three plots
            // skipped this sentence read "Saved to 3 plots" over one queued
            // record: a fabricated number under `P4`. The count now comes off
            // the queued result. (In demo mode there is no enqueue and no server
            // claim, so the local save count stands.)
            const queuedPlotCount = syncOutcome ? syncOutcome.queuedLogIds.length : logs.length;
            setToast(skippedSyncToast(syncOutcome, language) ?? {
                message: `Logged once. Saved to ${queuedPlotCount} plots. Day closure: ${beforePercent}% -> ${afterPercent}%`,
                type: 'success'
            });

            setStatus('success');
        } catch (error) {
            console.error('Critical error in handleWizardSubmit:', error);
            setError('Failed to save wizard logs. Please try again.');
        }
        // Pre-existing exhaustive-deps gap (predates Task 3.5) — see note on
        // handleAutoSave above; handleWizardSubmit also has no caller in the
        // app today.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [computeClosureDelta, history, logCommandService, setError, setHistory, setLastSavedLogIds, setLastSavedLogSummary, setPlannedTasks, setStatus, setToast, language]);

    // Note Updating - Simplified
    // This should also use Service if possible, but keeping lightweight update logic
    // Just ensure it updates the current 'history' state
    // Pre-existing `any` (predates Task 3.5) — see note on handleManualSubmit
    // in UseLogCommandsResult above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleUpdateNote = useCallback((logId: string, noteId: string, updates: any) => {
        const updater = (prevInfo: DailyLog[]) => prevInfo.map(log => {
            if (log.id !== logId) return log;
            return {
                ...log,
                observations: log.observations?.map(obs =>
                    obs.id === noteId ? { ...obs, ...updates } : obs
                )
            };
        });
        setHistory(updater);
    }, [setHistory]);


    return {
        handleAutoSave,
        handleFinalConfirm,
        handleManualSubmit,
        handleWizardSubmit,
        handleUpdateNote,
        service: logCommandService
    };
};

const mergeUniqueTasks = (existing: PlannedTask[], incoming: PlannedTask[]): PlannedTask[] => {
    if (incoming.length === 0) return existing;
    const merged = new Map<string, PlannedTask>();
    existing.forEach(task => merged.set(task.id, task));
    incoming.forEach(task => merged.set(task.id, task));
    return Array.from(merged.values());
};
