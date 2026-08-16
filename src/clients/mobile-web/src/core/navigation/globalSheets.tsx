// Sub-plan 04 Task 8 — extracted from AppRouter.tsx
// Always-mounted overlays (sheets + the QuickLog FAB) that previously lived at
// the bottom of AppRouter's JSX tree. Lifted verbatim here so the orchestrator
// stays small.

import React from 'react';
import { LogSegment, LogVerificationStatus, type BucketIssueType } from '../../types';
import { TaskCreationSheet, ReviewInboxSheet, QuickLogSheet } from './lazyComponents';
import { AppRouterContext } from './routeContext';
import { ConflictBadge } from '../../features/sync/conflict/ConflictBadge';
import { NoWorkReasonSheet } from '../../features/logs/components/NoWorkReasonSheet';

export const renderGlobalSheets = (ctx: AppRouterContext): React.ReactNode => {
    const {
        showTaskCreationSheet, setShowTaskCreationSheet, handleSaveTask,
        crops, farmerProfile,
        showReviewInbox, setShowReviewInbox, history, handleVerifyLog,
        showQuickLog, setShowQuickLog,
        setMode, setStatus, setRecordingSegment,
        currentRoute, setCurrentRoute, mainView, status, recordingSegment, hasActiveLogContext,
        showNoWorkReason, setShowNoWorkReason, handleManualSubmit, todayDateKey
    } = ctx;

    /**
     * FOUNDER DECISION 8 (2026-08-16), wave-3.10 — the NON-SPEECH fallback.
     *
     * A farmer who cannot or will not speak declares his day with one tap. This writes a
     * real `DailyLog` carrying `dayOutcome: 'NO_WORK_PLANNED'` and NO buckets, with a
     * genuine `source: 'manual'` provenance claim — the declaration came from a blank
     * state and nothing was typed or inferred, so the claim is honest and the sync layer
     * (which ships the draft only on that positive assertion) will carry it.
     *
     * `cause` is undefined when he skipped the chips, and doctrine P9 is the whole point:
     * the day saves regardless. Only when he gave one is a `disturbance` attached, and it
     * carries HIS chip as the reason — never an invented sentence.
     */
    const declareNoWorkDay = (cause?: BucketIssueType) => {
        setShowNoWorkReason(false);
        void handleManualSubmit({
            date: todayDateKey,
            dayOutcome: 'NO_WORK_PLANNED',
            // P9 — absent chip, absent disturbance. DisturbanceEvent.Create requires a
            // non-empty reason, so an empty one would be dropped server-side rather than
            // rejecting the record; sending nothing is the honest form of the same thing.
            disturbance: cause
                ? { scope: 'FULL_DAY' as const, group: 'no_work', reason: cause, cause, blockedSegments: [] }
                : undefined,
            provenance: { source: 'manual' as const, timestamp: new Date().toISOString() },
        });
    };

    return (
        <>
            <div
                className="fixed right-4 z-50"
                style={{ top: 'max(1rem, var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))' }}
            >
                <ConflictBadge onClick={() => setCurrentRoute('offline-conflicts')} />
            </div>

            {/* GLOBAL SHEETS */}
            <TaskCreationSheet
                isOpen={showTaskCreationSheet}
                onClose={() => setShowTaskCreationSheet(false)}
                onSave={handleSaveTask}
                crops={crops}
                selectedCropId={crops[0]?.id}
                people={farmerProfile.operators.map(op => ({ ...op, isActive: op.isActive ?? true }))}
            />

            {/* DFES Phase 0: Review Inbox Sheet */}
            <ReviewInboxSheet
                isOpen={showReviewInbox}
                onClose={() => setShowReviewInbox(false)}
                logs={history}
                operators={farmerProfile.operators}
                currentOperatorId={farmerProfile.activeOperatorId || 'owner'}
                onApproveLog={(logId: string) => handleVerifyLog(logId, LogVerificationStatus.APPROVED)}
                onApproveAll={(logIds: string[]) => logIds.forEach(id => handleVerifyLog(id, LogVerificationStatus.APPROVED))}
                onDisputeLog={(logId: string, note: string) => handleVerifyLog(logId, LogVerificationStatus.REJECTED, note)}
            />

            {/* DFES: QuickLogSheet (INT-3 Voice Integration) */}
            <QuickLogSheet
                isOpen={showQuickLog}
                onClose={() => setShowQuickLog(false)}
                onVoiceStart={() => {
                    setMode('voice');
                    setStatus('idle');
                }}
                onTypeSelect={(type) => {
                    if (type === 'no_work') {
                        // wave-3.10 — this branch used to merely open a blank manual-entry
                        // screen, and NOTHING recorded a typed no-work day: the declared-
                        // no-work acknowledgement was live for voice days only. It now
                        // leads to a real declaration.
                        setShowQuickLog(false);
                        setShowNoWorkReason(true);
                    } else {
                        setMode('manual');
                        setStatus('idle');
                        setRecordingSegment(type as LogSegment);
                    }
                }}
            />

            {/* wave-3.10, founder decision 8: the optional reason chips. Skipping saves the day. */}
            <NoWorkReasonSheet
                isOpen={showNoWorkReason}
                onDeclare={declareNoWorkDay}
                onClose={() => setShowNoWorkReason(false)}
            />

            {/* DFES: FAB to open QuickLogSheet (visible on main log view when idle) */}
            {
                currentRoute === 'main' && mainView === 'log' && status === 'idle' && !recordingSegment && hasActiveLogContext && (
                    <button
                        onClick={() => setShowQuickLog(true)}
                        data-testid="add-log-fab"
                        className="fixed z-40 w-14 h-14 bg-white text-emerald-600 rounded-full shadow-lg shadow-emerald-900/10 border border-emerald-100 flex items-center justify-center active:scale-95 transition-transform"
                        style={{
                            bottom: 'calc(6rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))',
                            left: 'max(1rem, var(--safe-area-inset-left, env(safe-area-inset-left, 0px)))'
                        }}
                        aria-label="Quick Log"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                )
            }
        </>
    );
};
