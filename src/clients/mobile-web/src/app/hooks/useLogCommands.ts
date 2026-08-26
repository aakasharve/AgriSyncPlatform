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
import { countAssertedPlots } from '../helpers/countAssertedPlots';
import { createInFlightSaveLock } from '../helpers/inFlightSaveLock';
import type { LogIntent } from './useAppNavigation';

// ARCHITECTURE FIX: Import Service Class and Hook
import { LogCommandServiceImpl } from '../../application/services/LogCommandService';
import { useDataSource } from '../providers/DataSourceProvider';
import { enqueueLogsForSync } from '../../features/logs/services/logSyncMutationService';
import { countCompletedIrrigationEvents } from '../../features/logs/services/irrigationCompletion';
// Labour Phase 2 / T2 — a record that never reached the sync queue is still ON
// THE PHONE, and it is described with the SAME words the header chip uses for
// that situation (T1's `sync.onPhone`). Two surfaces, one claim, one string.
// That lookup now happens inside `saveToastMessages`, which is why this hook no
// longer imports `SYNC_HONESTY_I18N_KEYS` itself — the reason for the deep
// import (the `features/sync` barrel drags `lucide-react`, `getDatabase` and the
// module-scope `backgroundSyncWorker` singleton into the graph for one string
// constant) moved there with it and is restated in that file.
//
// Final fix round, finding C-1 — the header chip is the ONE surface that stayed
// wrong. It derives its claim from `db.mutationQueue`, and a skipped log writes
// no row there, so on any device that has ever had a mutation applied
// (`APPLIED` rows are never pruned) the chip kept rendering `पाठवलं ✓` directly
// above a panel badge reading `फोनवर सेव्ह ✓ — cannot be sent`, about the record
// the farmer had just created. This is the only place in the app that ever holds
// that fact, so this is the only place that can tell it.
import { noteUnqueueableLogs } from '../../features/sync/status/unqueueableLogs';
import { useLanguage } from '../../i18n/LanguageContext';
import { buildEditSavedMessage, buildSkippedSyncToast } from '../helpers/saveToastMessages';

// spec: 2026-08-14-founder-decisions-launch-cohort-and-scope — fix round 3.
// `ManualSubmitOutcome` moved to `useLogCommands.types.ts` (its own doc
// comment lives there) to keep this file under the 800-line budget;
// re-exported here so existing `from './useLogCommands'` imports (and any
// future ones) keep working.
import type { ManualSubmitOutcome } from './useLogCommands.types';
export type { ManualSubmitOutcome };

export interface UseLogCommandsResult {
    handleAutoSave: (logData: AgriLogResponse, provenance?: LogProvenance) => Promise<void>;
    handleFinalConfirm: (editedData: AgriLogResponse | null, draftLog: AgriLogResponse | null) => Promise<void>;
    // Pre-existing `any` (predates Task 3.5; tracked project-wide by
    // Sub-plan 04 Task 10 per eslint.config.js) — not introduced by this
    // change, left as-is to avoid retyping the ManualEntry payload contract
    // out of scope.
    //
    // spec: 2026-08-14-founder-decisions-launch-cohort-and-scope — return
    // type widened from `Promise<void>` (round 0) to `Promise<boolean>`
    // (round 1) to `Promise<ManualSubmitOutcome>` (round 2 — see the type's
    // own doc comment for why boolean was not enough). The function ALWAYS
    // resolves — no-context guard, the double-tap lock, and a thrown save
    // error are each caught and turned into a toast/error state, never a
    // rejection — so "the promise resolved" was never proof a log was
    // written, and (round 2) "it returned false" was never proof it wasn't.
    // No existing caller inspected the old `void`/`boolean` return, so this
    // stays additive: `mainView.tsx` still passes this straight through as
    // `ManualEntry`'s `onSubmit`, whose prop type returns `void` —
    // TypeScript's void-return compatibility rule accepts a function that
    // returns MORE than void there unchanged.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleManualSubmit: (data: any) => Promise<ManualSubmitOutcome>;
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

/*
 * The two save sentences moved to `app/helpers/saveToastMessages.ts`.
 *
 * WHY: this hook sat at 797 of the 800 lines `check:file-sizes` allows, and the
 * wording work could not land without splitting something. They were the right
 * thing to move — pure, and the only part of this hook a wording test needs, so
 * asserting a sentence used to cost a `renderHook` plus four mocked services.
 *
 * WHAT DID NOT MOVE: every decision about WHEN they fire, which branch a save
 * takes, and how long a toast stays up. Those stay here, with the flow.
 *
 * LABOUR_PHASE2 B1b — `R4` expected the partial-save case to SELF-RESOLVE once
 * 2b removed multi-log batches. It NARROWS them; it does not remove them. A
 * shared engagement across three plots is now one record and one enqueue, so
 * the batch is gone for the case that created it — but a save where the farmer
 * pinned events to particular plots still emits one record per pinned plot plus
 * the shared one, and `enqueueLogsForSync` still has no per-log isolation, so a
 * throw on the first still abandons the rest. Rarer, not fixed. Carried.
 */

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

    /**
     * LABOUR_PHASE2 PHASE 4 (§A7.2) — the double-tap guard. One lock per mounted
     * hook, created once; see `app/helpers/inFlightSaveLock.ts` for why it
     * expires and why it is invisible.
     */
    const saveLock = useMemo(() => createInFlightSaveLock(), []);

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

            // LABOUR_PHASE2 B1b — "Stored In" must name every plot the record
            // asserts, because one record can now assert several. Reading
            // `selectedPlotNames[0]` told a farmer who logged across A, B and C
            // that his work was stored in A — narrower than what was written,
            // in the panel that outlives the toast. Single-plot is unchanged.
            const assertedPlotIds = log.context.selection.flatMap(entry => entry.selectedPlotIds || []);
            const assertedPlotNames = log.context.selection.flatMap(entry => entry.selectedPlotNames || []);
            const plotId = assertedPlotIds.length === 1 ? assertedPlotIds[0] : undefined;
            const plotName = (assertedPlotNames.length > 0 ? assertedPlotNames.join(', ') : '')
                || crops
                    .find(crop => crop.id === contextCropId)
                    ?.plots.find(plot => plot.id === assertedPlotIds[0])
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
            setToast(buildSkippedSyncToast(syncOutcome, language) ?? {
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
            setToast(buildSkippedSyncToast(syncOutcome, language) ?? {
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
    const handleManualSubmit = useCallback(async (data: any): Promise<ManualSubmitOutcome> => {
        if (!hasActiveLogContext) return 'not_saved'; // SAFE GUARD

        // LABOUR_PHASE2 PHASE 4 (§A7.2) — the second tap of a double-tap stops
        // here, before `createFromManual` can mint a second log id. Silent by
        // design: no message, no disabled control, nothing the farmer must
        // acknowledge (`P9`).
        //
        // spec: 2026-08-14-founder-decisions-launch-cohort-and-scope (fix
        // round 2) — `'already_saving'`, not `'not_saved'`. The WINNING call
        // of this race is the one actually writing; this losing call must
        // never be read as "nothing happened" by a caller deciding whether
        // to alert the farmer.
        if (!saveLock.tryAcquire()) return 'already_saving';

        // spec: 2026-08-14-founder-decisions-launch-cohort-and-scope (fix
        // round 2) — set the instant the durable write succeeds, BEFORE any
        // step that can still throw (sync enqueue, summary calc, toast
        // building). The catch block below reads this to tell "nothing was
        // written" from "written, then something downstream failed" — the
        // record must never be reported lost once it is actually saved.
        let wasWritten = false;

        try {
            let savedLogIds: string[];
            // May this submit show the full-screen "Saved to Ledger" panel
            // (`mainView.tsx:645`)?
            //
            // LABOUR_PHASE2 PHASE 4 — THE REASON CHANGED; THE ANSWER DID NOT.
            // T2 answered "no" for the edit branch because nothing was written
            // anywhere. That is no longer true — `updateLog` now calls
            // `repo.save`, so the panel's headline would be accurate. It still
            // stays `false`, on its own merits:
            //
            //   - The panel is CREATE-SHAPED. Its body is `lastSavedLogSummary`:
            //     a "Stored In" crop/plot card, a bucket breakdown of what the
            //     log CONTAINS, and a `syncQueued` badge derived from an enqueue
            //     outcome. An edit performs no enqueue, so that badge would have
            //     no evidence either way, and "Labour ×1 · Irrigation ×2"
            //     answers a question the farmer did not ask. They corrected 8 to
            //     6; the panel would not mention it.
            //   - It costs a screen state on the CORRECTION path, which `P2`
            //     wants cheaper than capture, not dearer — it replaces the form
            //     and hands back only "Review Details" / "View Activity
            //     Heatmap".
            //   - The confirmation that actually serves a correction already
            //     happens: `setHistory` plus the durable write mean the ledger
            //     list underneath shows 6 where it said 8. Seeing the number
            //     change is stronger evidence than a green panel asserting it.
            //
            // A correction-shaped panel ("8 → 6, sent to the server") would be a
            // real improvement. It is a new `.tsx` surface and needs a design
            // pass; reusing this one is not the same thing.
            let showSavedToLedgerPanel: boolean;

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
                wasWritten = true;

                // Update local state reflectively
                setHistory(prev => {
                    const filtered = prev.filter(l => l.id !== data.originalLogId);
                    return [result.log as DailyLog, ...filtered];
                });

                // LABOUR_PHASE2 PHASE 4 — R19 EXECUTED: THE OLD SENTENCE IS
                // DELETED, NOT SOFTENED. The wording and its reasoning now live
                // in `saveToastMessages.buildEditSavedMessage`; what stays here
                // is the decision to say it at all, and in which tone.
                //
                // THE ENGLISH TAIL IS GONE FROM THE CODE. It used to be
                // concatenated here — `${onPhone} — N labour corrections sent to
                // the server.` — so a farmer on the Marathi preference read one
                // sentence in two scripts, and no translator could ever have
                // reached the second half. Both halves are i18n now.
                const persistedCorrections = result.persistedLabourCorrections ?? 0;
                setToast({
                    // FINAL REVIEW F-1 — the third argument is the half of the
                    // edit no server call carried. `R19` had the caveat deleted
                    // on the reading that `repo.save` made it false; it made the
                    // LOCAL half false and left the SERVER half standing, so a
                    // farmer who fixed a headcount and an irrigation figure in
                    // one submit got a green tick over an irrigation change the
                    // next delta pull reverts — a pull the labour correction
                    // itself guarantees, because it advances `ModifiedAtUtc`.
                    //
                    // `?? false` is defensive only. `updateLog` sets the field on
                    // every `success: true` path, so the fallback is unreachable
                    // today; it exists because the field is optional on the
                    // response type. It is NOT a safe default — it suppresses the
                    // caveat — so if a second producer of `UpdateLogResponse`
                    // ever appears, it must set this rather than lean on this
                    // line.
                    message: buildEditSavedMessage(
                        persistedCorrections,
                        language,
                        result.hasUnsentChanges ?? false,
                    ),
                    // THE OUTCOME DECIDES THE COLOUR, not the branch.
                    //
                    // `'success'` when the whole edit landed. That case is
                    // unchanged and byte-identical: the record is in `db.logs`
                    // exactly as a created one is, the create path calls that
                    // `'success'`, and amber there would make a correction look
                    // more doubtful than the capture it corrects — training the
                    // farmer away from the one flow `P2` needs them to trust.
                    //
                    // `'partial'` when something in this edit reached no server
                    // (coordinator ruling, final review). The blanket `'success'`
                    // that stood here was defensible only while this toast could
                    // not say otherwise; now that it CAN, the asymmetry was
                    // indefensible. `buildSkippedSyncToast` renders the very same
                    // clause — "will not reach your farm records" — as `'partial'`
                    // on the create path, so one sentence had two colours
                    // depending on which screen produced it.
                    //
                    // The reading time was backwards, which is the sharper half.
                    // `ActionToast.DEFAULT_DURATION_MS` gives `success` 3000ms and
                    // `partial` 7000ms, so the LONGER sentence — the one carrying
                    // the caveat — got less than half the time of the shorter one.
                    //
                    // A green tick over a partial outcome is the exact shape this
                    // branch removed everywhere else; it is not kept here just
                    // because the partial half is quiet.
                    type: (result.hasUnsentChanges ?? false) ? 'partial' : 'success'
                });
                savedLogIds = [(result.log as DailyLog).id];
                showSavedToLedgerPanel = false;

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
                wasWritten = true;
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
                setToast(buildSkippedSyncToast(syncOutcome, language) ?? {
                    message: `Logged. Day closure: ${beforePercent}% -> ${afterPercent}%`,
                    type: 'success'
                });
                savedLogIds = newLogs.map(l => l.id);
                showSavedToLedgerPanel = true;
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
                // `'success'` is not a mood, it is the trigger for the
                // full-screen "Saved to Ledger" panel, which persists until the
                // farmer navigates away — long after the toast has gone
                // (`ActionToast.tsx:16`). See `showSavedToLedgerPanel` above for
                // why an edit still declines it now that it genuinely persists.
                //
                // A skipped CREATE keeps `'success'` on purpose. Its record IS
                // in the local ledger, so the panel's headline is true; what is
                // false there is only the implied "and it is on its way", and
                // the fix for that is the per-log `syncQueued` flag carried on
                // `lastSavedLogSummary` (rendered by `mainView.tsx`) — NOT
                // dropping to `'idle'`, which would return the farmer to a
                // populated form and invite a duplicate record. Wrong trade: a
                // soft contradiction is not worth a real double-entry.
                setStatus(showSavedToLedgerPanel ? 'success' : 'idle');
            }

            return 'saved';
        } catch (e) {
            console.error("Critical error in handleManualSubmit:", e);
            // spec: 2026-08-14-founder-decisions-launch-cohort-and-scope (fix
            // rounds 2-4) — a throw here can land AFTER the durable write
            // (`wasWritten`) if a post-write step failed (sync enqueue,
            // summary calc, toast build — all inside this same `try`). The
            // record is safe; "Failed to save logs. Please try again." is
            // actively wrong in that case — a retry would mint a duplicate.
            // Round 3 gave it its OWN outcome (`'saved_with_warning'`) so a
            // caller can tell it from a clean save and warn on its own
            // surface — which every caller must do, for the reason below.
            //
            // ROUND 4 (N2) — this comment used to say `setError` "only
            // renders on the main log screen's `AudioRecorder`". FALSE for
            // this path: `error` has exactly one reader, `mainView.tsx:388`
            // /`:405` (`externalError` on `AudioRecorder` /
            // `AudioRecorderStreaming`), and both sit inside the
            // `mode === 'voice'` branch, while `ManualEntry` — the only
            // caller of `handleManualSubmit` — is the OTHER branch. So this
            // message is mounted NOWHERE at that moment, the main log screen
            // included, and nothing clears `error` on a mode change, so it
            // can only surface later, decontextualised, in voice mode.
            if (wasWritten) {
                setError("Saved, but something after the save failed. Your entry is safe.");
                return 'saved_with_warning';
            }
            setError("Failed to save logs. Please try again.");
            return 'not_saved';
        } finally {
            // `finally`, so a save that FAILED releases as promptly as one that
            // succeeded. "Please try again" above must be an instruction the
            // farmer can actually follow — a failed save that left the button
            // inert would turn one bad network moment into a lost day (`P9`).
            saveLock.release();
        }
        // Pre-existing exhaustive-deps gap (predates Task 3.5; calculateLogSummary
        // and isDemoMode were already missing before this change) — Task 3.5
        // only added logIntent/setCurrentRoute/setLastLabourLogIds to this
        // array. Not widened further: calculateLogSummary is a plain,
        // unmemoized closure recreated every render, so adding it here would
        // make this callback lose its memoization on every render — a
        // separate, deliberate fix, not a byproduct of this task.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasActiveLogContext, logScope, crops, farmerProfile, logCommandService, setHistory, setPlannedTasks, setStatus, setError, setLastSavedLogSummary, setLastSavedLogIds, computeClosureDelta, history, setToast, logIntent, setCurrentRoute, setLastLabourLogIds, language, saveLock]);

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
            // LABOUR_PHASE2 B1b — and it counts PLOTS, not records. One record
            // now covers the whole selection, so counting records reported a
            // three-plot save as "Saved to 1 plots": the same sentence, newly
            // false, and this time an UNDER-count.
            const queuedPlotCount = countAssertedPlots(logs, syncOutcome);
            setToast(buildSkippedSyncToast(syncOutcome, language) ?? {
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
