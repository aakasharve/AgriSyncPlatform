/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 (I28, lane L4b; founder D-3, D-40 §3) — the ONE review sheet, mounted ONCE by the router
 * (`globalSheets.tsx`) for the selected farm. Every door opens it (`openApprovalReview`); it shows the one server list
 * (`approvalQueue`) and every मंजूर / शंका in it is the same server call. It replaces the old read-only
 * `ReviewInboxSheet`, which approved nothing and showed an unscoped, phone-local list.
 *
 * A confirmation the server refused as a stale version whose record no longer waits for anyone's मंजूर (someone else
 * decided it, or it was disputed) is settled here once the list is known — his decision concerned a version that is
 * gone, and the record itself is in the farm's history (my call, reported). Lane L4b fix round 1 (M-1): only THIS
 * farm's parked rows (the queue store keeps each farm's own), and only once the sheet was opened and the list was read
 * after that — never on a read made while he was not looking.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { DailyLog } from '../../types';
import ReviewSheet from '../labour/components/ReviewSheet';
import { EMPTY_LABOUR_DATA } from '../labour/labourMock';
import { useOptionalFarmContext } from '../../core/session/FarmContext';
import {
    approvalReadTicket, notifyApprovalSent, refreshApprovalQueue, settleVersionConflict, takeApprovalFocus,
} from './approvalQueue';
import { useApprovalQueue } from './useApprovalQueue';

export interface ApprovalReviewHostProps {
    open: boolean;
    onClose: () => void;
    history?: DailyLog[];
    /** Overrides the farm (tests, previews); default the selected farm. */
    farmId?: string | null;
    /** lane IT5 (Task 2b) - the phone holder's own name, for his check on a product (never "तुम्ही"). */
    ownName?: string;
}

const TOAST_MS = 2600;

export const ApprovalReviewHost: React.FC<ApprovalReviewHostProps> = ({ open, onClose, history, farmId: farmOverride, ownName }) => {
    const farmCtx = useOptionalFarmContext();
    const farmId = farmOverride ?? farmCtx?.currentFarmId ?? null;
    const queue = useApprovalQueue(farmId, { autoRefresh: false });
    const [focusLogId, setFocusLogId] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    // M-1 — the read ticket when the sheet opened: only a list read after it may settle a parked conflict.
    const openedAtTicketRef = useRef<number | null>(null);

    // Opening reads the list again: the sheet shows what the server holds NOW, the same list as every door's count.
    useEffect(() => {
        if (!open) {
            openedAtTicketRef.current = null;
            return;
        }
        setFocusLogId(takeApprovalFocus());
        openedAtTicketRef.current = approvalReadTicket();
        void refreshApprovalQueue(farmId);
    }, [open, farmId]);

    useEffect(() => {
        const openedAt = openedAtTicketRef.current;
        // M-1 / N-1 — only the sheet's own facts read after it opened settle anything (a publish carries none).
        if (!open || openedAt === null || queue.factsTicket === null || queue.factsTicket <= openedAt) return;
        if (queue.status !== 'known' || !queue.data) return;
        const waiting = new Set(queue.data.review.map((r) => r.id));
        queue.conflicts
            .filter((c) => c.farmId === farmId && !waiting.has(c.logId))
            .forEach((c) => { void settleVersionConflict(farmId, c.rowId); });
    }, [open, queue.status, queue.data, queue.conflicts, queue.factsTicket, farmId]);

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(null), TOAST_MS);
        return () => window.clearTimeout(timer);
    }, [toast]);

    return (
        <>
            <ReviewSheet
                open={open}
                data={queue.data ?? EMPTY_LABOUR_DATA}
                onClose={onClose}
                onToast={setToast}
                onApproved={() => {
                    // H-2 — a read that started after the send, so a card still carried comes back.
                    void refreshApprovalQueue(farmId, { afterNow: true });
                    // L-8 — the हजेरी page (and any page showing this farm's records) reads its own data again.
                    if (farmId) notifyApprovalSent(farmId);
                }}
                reviewListUnknown={queue.status === 'unknown' || (queue.status === 'idle' && !queue.data)}
                reviewListLoading={queue.status === 'loading' && !queue.data}
                farmId={farmId ?? undefined}
                history={history}
                conflicts={queue.conflicts}
                onConflictSettled={(rowId) => { void settleVersionConflict(farmId, rowId); }}
                focusLogId={focusLogId}
                pendingDecisionIds={queue.pendingDecisionIds}
                listTicket={queue.factsTicket}
                ownName={ownName}
            />
            {toast && (
                <div role="status" data-testid="approval-toast" className="fixed inset-x-4 top-4 z-[70] mx-auto max-w-[440px] rounded-2xl bg-stone-900 px-4 py-3 text-center text-[16px] font-bold text-white shadow-xl">
                    {toast}
                </div>
            )}
        </>
    );
};

export default ApprovalReviewHost;
