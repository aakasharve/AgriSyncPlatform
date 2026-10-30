/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-08, LP-13)
 *
 * Two honest facts about the recording he just made:
 *
 * 1. WHERE IT IS (`useLogSyncState`). "लक्षात ठेवलं" is true the moment the screen exists (it appears only
 *    after the durable phone write). "On the server" is claimed ONLY when the sync queue holds the server's
 *    acknowledgement for that log's create (`APPLIED`), the same evidence rule as the header chip
 *    (`syncHonestyState.ts`). A row parked for review is "needs a hand". No row = no server claim at all.
 *
 * 2. THE OWNER'S CONFIRM (`useConfirmRecording`). Spec I27 (founder D-44 / D-46) AMENDS I13: the speaker is
 *    never asked to confirm his own record. Only the PRIMARY OWNER sees "पक्कं आहे" on his own recording — his
 *    "save and confirm" — and it sends the EXISTING verify (`verify_log_v2`, decision `verify`) for THAT log only,
 *    with `reviewBasis` 'heard' when he played his clip and 'read' otherwise (D-44: "noted as read-not-heard").
 *    The record counts whether or not anyone ever confirms it (founder 2026-09-02).
 *    "तुम्ही पक्कं केलं" states HIS act (queued on this phone), never that the server has accepted it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from '@xstate/react';
import { getRootStore } from '../../../../app/state/RootStore';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { MAX_AUTO_RETRY_COUNT } from '../../../../infrastructure/sync/retryCap';
import { verifyLog } from '../../../../application/usecases/VerifyLog';
import type { AuditPort } from '../../../../application/ports/AuditPort';
import type { LogsRepository } from '../../../../application/ports';
import type { FarmerProfile } from '../../../../types';

export type LogSyncState = 'onPhone' | 'onServer' | 'needsFix';

/** The sync claim for these logs, from their `create_daily_log` rows. Re-read after every sync cycle. */
export function useLogSyncState(logIds: readonly string[]): LogSyncState {
    const [state, setState] = useState<LogSyncState>('onPhone');
    const lastSyncAtMs = useSelector(getRootStore().sync, s => s.context.lastSyncAtMs);
    const key = logIds.join(',');
    useEffect(() => {
        let cancelled = false;
        const ids = new Set(key ? key.split(',') : []);
        void (async () => {
            try {
                const rows = (await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray())
                    .filter(r => ids.has(String((r.payload as { dailyLogId?: unknown } | null)?.dailyLogId ?? '')));
                const next: LogSyncState = rows.some(r => r.status === 'REJECTED_USER_REVIEW' || (r.status === 'FAILED' && r.retryCount >= MAX_AUTO_RETRY_COUNT))
                    ? 'needsFix'
                    : rows.length > 0 && rows.length >= ids.size && rows.every(r => r.status === 'APPLIED') ? 'onServer' : 'onPhone';
                if (!cancelled) setState(next);
            } catch {
                if (!cancelled) setState('onPhone');
            }
        })();
        return () => { cancelled = true; };
    }, [key, lastSyncAtMs]);
    return state;
}

export interface ConfirmDeps {
    verifierUserId: string | null;
    repository: LogsRepository;
    auditPort: AuditPort;
    profile: FarmerProfile;
}

export function useConfirmRecording({ verifierUserId, repository, auditPort, profile }: ConfirmDeps) {
    const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(() => new Set());
    const [failed, setFailed] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // Logs whose verify is queued or on its way, read synchronously: a second tap in the same moment (before
    // React re-renders) must not queue a second verify for the same log.
    const sent = useRef(new Set<string>());

    const confirm = useCallback(async (logId: string, reviewBasis: 'heard' | 'read'): Promise<boolean> => {
        if (!verifierUserId || sent.current.has(logId)) return false;
        sent.current.add(logId);
        setBusy(true);
        setFailed(null);
        try {
            const result = await verifyLog({ logId, verifierId: verifierUserId, action: 'approve', reviewBasis }, repository, auditPort, profile);
            if (result.success) setConfirmed(s => new Set(s).add(logId));
            else { sent.current.delete(logId); setFailed(logId); }
            return result.success;
        } finally {
            setBusy(false);
        }
    }, [verifierUserId, repository, auditPort, profile]);

    return { confirmed, failed, busy, confirm };
}
