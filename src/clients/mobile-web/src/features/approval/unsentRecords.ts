/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 (I28, lane L4b; founder D-40 §2) — "पाठवणे बाकी N": records on THIS PHONE that are not on the server
 * yet and are still on their way (the sync worker is sending or will retry them by itself). It is never a farm-wide
 * number (a phone-local count must not look like every phone of the farm), and ordinary offline is never called
 * "अडकलेल्या": rows that really need him (refused, or past the retry cap) are NOT counted here — the strip says those
 * separately, with the failure words.
 *
 * Records, not queue rows: one record's several changes (saved, a task added, a मंजूर) count once.
 */
import { useEffect, useState } from 'react';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { MAX_AUTO_RETRY_COUNT } from '../../infrastructure/sync/retryCap';

export interface UnsentRow {
    clientRequestId: string;
    status: string;
    retryCount: number;
    payload: unknown;
}

/** The fields a payload names its record by, most specific first. */
const RECORD_KEYS = [
    'dailyLogId', 'logId', 'costEntryId', 'attendanceMarkId', 'recordId', 'attachmentId', 'jobCardId',
    'labourAssignmentId', 'plannedActivityId', 'harvestId',
] as const;

export function recordKeyOf(row: UnsentRow): string {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    for (const key of RECORD_KEYS) {
        const value = payload[key];
        if (typeof value === 'string' && value.length > 0) return `${key === 'logId' ? 'dailyLogId' : key}:${value}`;
    }
    return `row:${row.clientRequestId}`;
}

/** Is the worker still carrying this row by itself (not refused, not past the cap)? */
export function isOnItsWay(row: UnsentRow): boolean {
    if (row.status === 'PENDING' || row.status === 'SENDING') return true;
    return row.status === 'FAILED' && row.retryCount < MAX_AUTO_RETRY_COUNT;
}

/** This phone's unsent records: distinct records among the rows on their way, plus photos and recordings uploading. */
export function unsentRecordCount(rows: readonly UnsentRow[], pendingUploads: number, pendingRecordings: number): number {
    const records = new Set(rows.filter(isOnItsWay).map(recordKeyOf));
    return records.size + Math.max(0, pendingUploads) + Math.max(0, pendingRecordings);
}

const POLL_MS = 3000;

/** The live "पाठवणे बाकी" number, read from this phone's own queues only. */
export function useUnsentRecordCount(): number {
    const [count, setCount] = useState(0);
    useEffect(() => {
        let alive = true;
        const read = async () => {
            try {
                const db = getDatabase();
                const rows = await db.mutationQueue.where('status').anyOf('PENDING', 'SENDING', 'FAILED').toArray();
                const uploads = await db.uploadQueue.where('status').anyOf('pending', 'uploading', 'retry_wait').count();
                const recordings = await db.pendingAiJobs.where('status').anyOf('pending', 'processing').count();
                if (alive) setCount(unsentRecordCount(rows as UnsentRow[], uploads, recordings));
            } catch {
                // An unreadable queue keeps the last number; it never invents a zero.
            }
        };
        void read();
        const timer = window.setInterval(() => { void read(); }, POLL_MS);
        return () => { alive = false; window.clearInterval(timer); };
    }, []);
    return count;
}
