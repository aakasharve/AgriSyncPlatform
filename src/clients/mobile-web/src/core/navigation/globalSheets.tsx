// Sub-plan 04 Task 8 — extracted from AppRouter.tsx
// Always-mounted overlays (sheets + the QuickLog FAB) that previously lived at
// the bottom of AppRouter's JSX tree. Lifted verbatim here so the orchestrator
// stays small.

import React from 'react';
import { LogSegment, LogVerificationStatus } from '../../types';
import { TaskCreationSheet, ReviewInboxSheet, QuickLogSheet } from './lazyComponents';
import { AppRouterContext } from './routeContext';

export const renderGlobalSheets = (ctx: AppRouterContext): React.ReactNode => {
    const {
        showTaskCreationSheet, setShowTaskCreationSheet, handleSaveTask,
        crops, farmerProfile,
        showReviewInbox, setShowReviewInbox, history, handleVerifyLog,
        showQuickLog, setShowQuickLog,
        setMode, setStatus, setRecordingSegment,
        currentRoute, mainView, status, recordingSegment, hasActiveLogContext
    } = ctx;

    return (
        <>
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
                        setMode('manual');
                        setStatus('idle');
                    } else {
                        setMode('manual');
                        setStatus('idle');
                        setRecordingSegment(type as LogSegment);
                    }
                }}
            />

            {/* DFES: FAB to open QuickLogSheet (visible on main log view when idle) */}
            {
                currentRoute === 'main' && mainView === 'log' && status === 'idle' && !recordingSegment && hasActiveLogContext && (
                    <button
                        onClick={() => setShowQuickLog(true)}
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
