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
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Mic, Trash2 } from 'lucide-react';
import { useAppDataState, useAppCommandsState, useAppLogState, useAppViewHelpers } from '../app/context/AppFeatureContexts';
import { getDateKey } from '../core/domain/services/DateKeyService';
import type { TodayCounts } from '../domain/types/farm.types';
import ManualEntry from '../features/logs/components/ManualEntry';
import type { ManualEntryProps } from '../features/logs/components/manual-entry/types';
import {
    listUnreviewedAiResults,
    markAiResultReviewed,
    buildAiDraftForReview,
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

function formatReceivedAt(iso: string): string {
    try {
        return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
    const { setLogScope } = useAppLogState();
    const { getTodayCounts } = useAppViewHelpers();

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
    // on a no-op (no active context, a losing double-tap) or a caught save
    // failure; "the promise resolved" was never proof a log was written. It
    // now resolves `true` only when it actually created or updated a log
    // (`useLogCommands.ts`); this reads that signal instead of assuming it.
    const handleSubmit: ManualEntryProps['onSubmit'] = async (data) => {
        const saved = await handleManualSubmit(data);
        if (!saved) {
            // Nothing was written. Do NOT mark the draft reviewed — Step 4 of
            // the brief is "only after the farmer acts", and a no-op is not
            // an act. Stay on the review screen so the note is not lost.
            window.alert('Could not save this log. Please try again.');
            return;
        }

        if (reviewing) {
            await markAiResultReviewed(reviewing.job.id);
        }
        setReviewing(null);
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
                    onClick={() => setReviewing(null)}
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
                                    <p className="text-xs font-bold text-slate-400">{formatReceivedAt(job.result.receivedAtUtc)}</p>
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
