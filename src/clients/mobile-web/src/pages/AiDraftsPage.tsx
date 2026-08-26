/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lists the offline voice notes waiting for the farmer's review
 * (`pendingAiJobs.result`, unread since `27e55ce7` landed the write half of
 * this fix) and routes "Review" into the EXISTING `ManualEntry` confirm
 * surface — the same component the live voice-parse path and the
 * edit-existing-log path already use. A draft is an offer, never a record:
 * this page never creates a `DailyLog` and never marks anything confirmed on
 * its own — `ManualEntry`'s own Save button does that, through the app's
 * normal submit path.
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mic, Trash2 } from 'lucide-react';
import { useAppDataState, useAppCommandsState, useAppLogState, useAppViewHelpers, useAppVoiceState } from '../app/context/AppFeatureContexts';
import { getDateKey } from '../core/domain/services/DateKeyService';
import type { TodayCounts } from '../domain/types/farm.types';
import ManualEntry from '../features/logs/components/ManualEntry';
import type { ManualEntryProps } from '../features/logs/components/manual-entry/types';
import { formatDisplayDateTime } from '../shared/utils/displayTime';
import {
    listUnreviewedAiResults,
    markAiResultReviewed,
    buildAiDraftForReview,
    resolveRecordedInstant,
    type UnreviewedAiResult,
    type AiDraftForReview,
} from '../infrastructure/sync/PendingAiResultsReader';

interface AiDraftsPageProps {
    onBack: () => void;
}

type ReviewingDraft = { job: UnreviewedAiResult } & AiDraftForReview;

/** English-only placeholder copy (Global Constraint: never compose new Marathi). */
function operationNoun(job: UnreviewedAiResult): string {
    if (job.operationType === 'receipt_extract') return 'receipt scan';
    if (job.operationType === 'patti_extract') return 'patti scan';
    return 'voice note';
}

/** IMPORTANT 2 (fix round 1) — operation-correct, not hardcoded to "voice note". */
function discardConfirmMessage(job: UnreviewedAiResult): string {
    const destination = job.operationType === 'voice_parse' ? 'log' : 'records';
    return `Discard this ${operationNoun(job)}? It will not be added to your ${destination}.`;
}

function previewLabel(job: UnreviewedAiResult): string {
    if (job.operationType !== 'voice_parse') {
        return job.operationType === 'receipt_extract' ? 'Receipt scan' : 'Patti scan';
    }

    const payload = job.result.payload as { parsedLog?: Record<string, unknown> } | undefined;
    const parsedLog = payload?.parsedLog;
    const summary = parsedLog && typeof parsedLog.summary === 'string' ? parsedLog.summary : undefined;
    const transcript = parsedLog && typeof parsedLog.fullTranscript === 'string' ? parsedLog.fullTranscript : undefined;
    return summary || transcript || job.context.textTranscript || 'Voice note';
}

// NEW (fix round 3) — renamed from `formatReceivedAt`, and its caller below
// switched from `job.result.receivedAtUtc` (the DRAIN instant) to
// `resolveRecordedInstant(job)` (the same capture-preferring instant
// `buildAiDraftForReview` dates the saved log from). Before this, an offline
// text note drained the morning after it was typed showed one day HERE and
// saved under a DIFFERENT day once reviewed — the same note, two dates, on
// one screen.
function formatRecordedAt(iso: string): string {
    try {
        return formatDisplayDateTime(iso, iso);
    } catch {
        return iso;
    }
}

const AiDraftsPage: React.FC<AiDraftsPageProps> = ({ onBack }) => {
    const { crops, farmerProfile, ledgerDefaults } = useAppDataState();
    const { handleManualSubmit } = useAppCommandsState();
    // CRITICAL 1 & 2 (fix round 1) — `handleManualSubmit` attributes and gates
    // the save on the APP-LEVEL `logScope` (`useLogCommands.ts`), not on the
    // `context` prop this page hands to `ManualEntry` for rendering. Those are
    // two different pieces of state. Without `setLogScope` here, either
    // `hasActiveLogContext` is false (nothing farmer ever selected elsewhere)
    // and the save silently no-ops, or a stale scope from something else the
    // farmer looked at earlier is still selected and the log lands on THAT
    // plot instead of the one this draft was recorded on. `AppRouter.tsx`'s
    // `handleEditLog` sets `logScope` before mounting `ManualEntry` for the
    // exact same reason; this page must do the same for the same reason.
    const { logScope, setLogScope } = useAppLogState();
    const { getTodayCounts } = useAppViewHelpers();
    // NEW 4 (fix round 2) — a successful draft save runs handleManualSubmit's
    // own success path, which sets the app-level `status` to `'success'` (the
    // trigger for mainView's full-screen "Saved to Ledger" panel). Nothing
    // resets it on route change, so without this the farmer's NEXT visit to
    // main/log would land on a stale panel for a save made on THIS screen.
    const { setStatus } = useAppVoiceState();

    // NEW 1 (fix round 2) — `setLogScope` in `handleReview` overwrites the
    // APP-LEVEL scope for the rest of the session unless something restores
    // it. `LogContext.resetScope` has no production caller, so this page must
    // do its own bookkeeping: snapshot whatever scope was active before this
    // page ever touched it (captured ONCE, on first mount — `useRef`'s
    // initial-value argument is ignored on every render after the first),
    // and hand it back whenever review closes or this page unmounts. Without
    // this, merely tapping Review and backing out leaves `hasActiveLogContext`
    // true for the draft's plot, and the farmer's NEXT voice/manual capture on
    // the main log screen — unrelated to this draft — lands there instead.
    const originalLogScopeRef = useRef(logScope);
    const restoreLogScope = useCallback(() => {
        setLogScope(originalLogScopeRef.current);
    }, [setLogScope]);
    useEffect(() => {
        return () => {
            restoreLogScope();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [drafts, setDrafts] = useState<UnreviewedAiResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [reviewing, setReviewing] = useState<ReviewingDraft | null>(null);
    const [busyJobId, setBusyJobId] = useState<number | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        const results = await listUnreviewedAiResults();
        setDrafts(results);
        setLoading(false);
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Leaves the review screen and restores the app-level scope, whether the
    // farmer backed out or just finished a successful save. The ONE place
    // `reviewing` is cleared, so the restore can never be forgotten on a path
    // that adds a new way to leave.
    const closeReview = useCallback(() => {
        restoreLogScope();
        setReviewing(null);
    }, [restoreLogScope]);

    const handleReview = (job: UnreviewedAiResult) => {
        const built = buildAiDraftForReview(job, crops);
        if (!built) {
            window.alert('This draft cannot be opened for review here yet.');
            return;
        }

        const primarySelection = built.context.selection[0];
        setLogScope({
            selectedCropIds: [primarySelection.cropId],
            selectedPlotIds: primarySelection.selectedPlotIds,
            mode: 'single',
            applyPolicy: 'broadcast',
        });
        setReviewing({ job, ...built });
    };

    const handleDiscard = async (job: UnreviewedAiResult) => {
        if (!window.confirm(discardConfirmMessage(job))) {
            return;
        }
        setBusyJobId(job.id);
        try {
            await markAiResultReviewed(job.id);
            await refresh();
        } finally {
            setBusyJobId(null);
        }
    };

    // The ONLY place this page marks a draft reviewed on the confirm path —
    // and only after `handleManualSubmit` (the farmer's real save action)
    // ACTUALLY SAVED something, not merely resolved. Scoped to this closure
    // alone: there is no shared mutable "which job am I reviewing" state
    // outside this component, so there is nothing here that can leak into an
    // unrelated later save.
    //
    // IMPORTANT 3 (fix round 1) — `handleManualSubmit` always resolves, even
    // on a no-op or a caught save failure; "the promise resolved" was never
    // proof a log was written.
    //
    // NEW 2 (fix round 2) — a plain boolean was not enough: it collapsed "the
    // losing tap of a double-tap" (a save that IS happening, via the OTHER
    // call — must stay silent, per `useLogCommands.ts`'s own "Silent by
    // design" comment) into the same `false` as a genuine no-op.
    //
    // NEW (fix round 3) — `'saved'` was still collapsing two outcomes: a
    // clean save, and a save where the write succeeded but a LATER step
    // (sync enqueue) failed. Treating that as plain `'saved'` meant this
    // page told the farmer nothing, marked the draft reviewed, and refreshed
    // — the row vanished with the log sitting in Dexie and nothing queued to
    // sync. `'saved_with_warning'` is its own outcome so this page can say so
    // on ITS OWN surface, using the `window.alert` it already has below —
    // BEFORE marking reviewed, never suggesting a retry (the record is safe;
    // retrying would duplicate it).
    //
    // ROUND 4 (N2) — a sentence has been deleted from the paragraph above.
    // It said `useLogCommands.ts`'s `setError` "renders on exactly one
    // surface — the main log screen's `AudioRecorder`". It renders on NO
    // surface for this outcome: `mainView.tsx:388`/`:405` pass `error` as
    // `externalError` to `AudioRecorder`/`AudioRecorderStreaming`, and both
    // are mounted only when `mode === 'voice'`, whereas `ManualEntry` — the
    // only caller of `handleManualSubmit` — is the other branch. What this
    // page says below is therefore not a second copy of a message shown
    // elsewhere; it is the only place the farmer is told at all.
    const handleSubmit: ManualEntryProps['onSubmit'] = async (data) => {
        const outcome = await handleManualSubmit(data);

        if (outcome === 'already_saving') {
            // The losing tap of a double-tap. The WINNING call is doing (or
            // has done) the save; alerting here would contradict a save that
            // is succeeding. Do nothing — matches the silent design at
            // useLogCommands.ts's saveLock guard.
            return;
        }

        if (outcome === 'not_saved') {
            // Genuinely nothing was written. Do NOT mark the draft reviewed —
            // Step 4 of the brief is "only after the farmer acts", and a
            // no-op is not an act. Stay on the review screen so the note is
            // not lost.
            window.alert('Could not save this log. Please try again.');
            return;
        }

        if (outcome === 'saved_with_warning') {
            // ROUND 4 (N1) — this said "Saved, but not sent yet. It will send
            // automatically once you are back online." Both halves were false
            // on the exact path that shows it, and `saveToastMessages.ts`
            // already forbids the shape in writing: "never 'not yet' … a
            // promise of a retry that no code path can keep".
            //   - The documented trigger is `MutationQueue.enqueue` throwing
            //     on payload validation, NOT being offline. Blaming
            //     connectivity points the farmer at a cause he can "fix" by
            //     waiting, which does nothing.
            //   - `enqueueLogsForSync` has no try/catch, so on that trigger no
            //     mutation row was ever written: nothing is queued for a
            //     worker to pick up, `noteUnqueueableLogs` never ran so not
            //     even the session honesty registry learned, and
            //     `logSyncMutationService.ts` states there is no backfill job
            //     in this system. On the EDIT branch nothing is enqueued at
            //     all, ever. Nothing will "send automatically".
            //
            // The replacement claims only what this code can prove, in the
            // order `saveToastMessages.ts` established: the phone claim FIRST
            // (true, and saying it is what stops the farmer re-recording a
            // record that already exists), then the failure, then the
            // present-perfect fact that it is not in the farm records.
            //
            // IT MAKES NO CLAIM ABOUT THE FUTURE, deliberately. "will not
            // reach your farm records" is the honest tense for a KNOWN-skipped
            // record (`buildSkippedSyncToast`), but this one outcome also
            // covers a throw from a step that runs AFTER a SUCCESSFUL enqueue
            // (`calculateLogSummary`, `computeClosureDelta`), where a queued
            // row does exist and the worker will carry it. The catch block
            // cannot tell those apart, so promising either direction would
            // swap one false claim for another. `buildEditSavedMessage`'s zero
            // branch is the precedent: no claim beats a claim with no use.
            //
            // English placeholder only (Global Constraint): no Marathi is
            // composed here, and no existing Marathi string says this.
            window.alert('Saved on your phone. Something after the save failed, and it has not reached your farm records.');
        }

        // outcome is 'saved' or 'saved_with_warning' — either way the record
        // is durably in the ledger, so it is safe to mark this draft reviewed.
        //
        // NEW 4 (fix round 2) — undo handleManualSubmit's own `setStatus(
        // 'success')`. That status exists to trigger mainView's full-screen
        // "Saved to Ledger" panel on the LIVE capture screen; left standing,
        // the farmer's next visit to main/log would show that panel for a
        // save made here instead.
        setStatus('idle');

        if (reviewing) {
            await markAiResultReviewed(reviewing.job.id);
        }
        closeReview();
        await refresh();
    };

    if (reviewing) {
        // CRITICAL 3 (fix round 1) — built the same way `mainView.tsx` builds
        // it for the live path. Omitting this prop falls back to all-zero
        // counts (`ManualEntry.tsx`'s `zeroTodayCounts`), which reads as "you
        // have logged nothing today" even when the farmer already has —a
        // fabricated number standing in for an unknown.
        const todayCountsMap: Record<string, TodayCounts> = {};
        const todayStr = getDateKey();
        const plotIdsInScope = new Set<string>();
        reviewing.context.selection.forEach(selection => selection.selectedPlotIds.forEach(id => plotIdsInScope.add(id)));
        plotIdsInScope.forEach(plotId => {
            todayCountsMap[plotId] = getTodayCounts(plotId, todayStr);
        });

        return (
            <div className="max-w-4xl mx-auto px-4 py-6 pb-24 min-h-screen bg-slate-50">
                <button
                    type="button"
                    onClick={closeReview}
                    className="mb-4 flex items-center gap-1.5 rounded-full bg-white py-2 pl-2.5 pr-3.5 text-[13px] font-bold text-slate-700 shadow-sm ring-1 ring-slate-100"
                >
                    <ArrowLeft size={16} /> Back to Drafts
                </button>
                <ManualEntry
                    context={reviewing.context}
                    crops={crops}
                    defaults={ledgerDefaults}
                    profile={farmerProfile}
                    onSubmit={handleSubmit}
                    initialData={reviewing.agriLog}
                    provenance={reviewing.provenance}
                    onDataConsumed={() => {}}
                    todayCountsMap={todayCountsMap}
                    recordedDateKey={reviewing.recordedDateKey}
                />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 pb-24 min-h-screen bg-slate-50">
            <div className="mb-6 flex items-center gap-3">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex items-center gap-1.5 rounded-full bg-white py-2 pl-2.5 pr-3.5 text-[13px] font-bold text-slate-700 shadow-sm ring-1 ring-slate-100"
                >
                    <ArrowLeft size={16} /> Back
                </button>
                <div>
                    <h1 className="text-2xl font-black text-slate-800 tracking-tight">AI Drafts</h1>
                    <p className="text-slate-500 font-medium text-sm">Voice notes recorded offline, waiting for your review</p>
                </div>
            </div>

            {loading && <p className="text-slate-400 text-sm">Loading...</p>}

            {!loading && drafts.length === 0 && (
                <div className="rounded-3xl border border-dashed border-slate-200 p-12 text-center bg-white/50">
                    <div className="w-16 h-16 bg-emerald-50 text-emerald-300 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Mic size={32} />
                    </div>
                    <h3 className="font-bold text-slate-400 text-lg">All caught up!</h3>
                    <p className="text-sm text-slate-300 mt-1">No offline notes waiting for review.</p>
                </div>
            )}

            <div className="space-y-3">
                {drafts.map(job => {
                    const reviewable = job.operationType === 'voice_parse';
                    return (
                        <div key={job.id} className="glass-panel p-4 rounded-2xl flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
                                    <Mic size={18} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-bold text-slate-400">{formatRecordedAt(resolveRecordedInstant(job))}</p>
                                    <p className="text-sm text-slate-700 line-clamp-2">{previewLabel(job)}</p>
                                    {/* IMPORTANT 2 (fix round 1) — a row with only a Discard
                                        affordance and no explanation reads as a dead end. Say
                                        plainly that review isn't built for this yet, and that
                                        the row is kept, not lost, if the farmer does nothing. */}
                                    {!reviewable && (
                                        <p className="text-xs text-amber-600 mt-1">Review isn't available for this yet. You can discard it, or leave it here.</p>
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-2 shrink-0">
                                {reviewable && (
                                    <button
                                        type="button"
                                        onClick={() => handleReview(job)}
                                        className="rounded-full bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold"
                                    >
                                        Review
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => handleDiscard(job)}
                                    disabled={busyJobId === job.id}
                                    className="p-2 rounded-lg bg-slate-100 text-slate-400 hover:bg-rose-100 hover:text-rose-600 disabled:opacity-50"
                                    title="Discard"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default AiDraftsPage;
