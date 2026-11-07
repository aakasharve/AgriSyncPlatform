/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 (I28, lane L4b; founder D-40 §1) — every door's view of the ONE approval list for a farm. Reading it
 * refreshes the list when it is missing or stale, and again when the phone comes back online or into view.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
    approvalCountOf,
    getApprovalQueue,
    mayConfirmFrom,
    refreshApprovalQueue,
    refreshApprovalQueueIfStale,
    subscribeApprovalQueue,
    type ApprovalQueueState,
} from './approvalQueue';

export interface ApprovalQueueView extends ApprovalQueueState {
    /** "मंजुरीसाठी N", or `null` when no number may be shown (unknown, or he may not confirm). */
    count: number | null;
    mayConfirm: boolean;
    refresh: () => Promise<void>;
}

export function useApprovalQueue(farmId: string | null | undefined, options: { autoRefresh?: boolean } = {}): ApprovalQueueView {
    const autoRefresh = options.autoRefresh ?? true;
    const state = useSyncExternalStore(
        subscribeApprovalQueue,
        () => getApprovalQueue(farmId),
        () => getApprovalQueue(farmId),
    );

    useEffect(() => {
        if (!autoRefresh || !farmId) return;
        void refreshApprovalQueueIfStale(farmId);
        const again = () => { void refreshApprovalQueueIfStale(farmId); };
        const onVisible = () => { if (document.visibilityState === 'visible') again(); };
        window.addEventListener('online', again);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.removeEventListener('online', again);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [farmId, autoRefresh]);

    const refresh = useCallback(() => refreshApprovalQueue(farmId), [farmId]);

    return { ...state, count: approvalCountOf(state), mayConfirm: mayConfirmFrom(state.data), refresh };
}
