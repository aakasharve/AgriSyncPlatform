// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1, item 11 (founder D-71), and fix pass 2
// (review N-1, N-6).
//
// His erasure requests, from the server (GET /shramsafal/me/erasure/requests), and the cancel
// (POST /shramsafal/me/erasure/{id}/cancel). The server decides: 200 = cancelled (nothing erased), 409 = it has
// already started (said so, not as a failure), anything else = could not. The screen owns this, so it can show his
// waiting request in place of a new "erase" button (N-1).

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../infrastructure/api/apiFetch';
import type { DataRightsRequestRow, DataRightsRequestStatus } from './RecentRequestsList';

interface ErasureRequestView {
    requestId: string;
    status: DataRightsRequestStatus;
    requestedAtUtc: string;
    erasureStartsAtUtc: string | null;
    endedAtUtc: string | null;
    mayCancel: boolean;
    askedByMe: boolean;
    /** fix pass 2 (N-6): false when the reader (the platform admin) filed it for someone else's data. */
    aboutMe?: boolean;
}

export type ErasureNotice = 'cancelDone' | 'cancelStarted' | 'cancelError' | 'loadError' | null;

export interface MyErasureRequests {
    /** null until the server has answered (or if it could not be read). */
    rows: DataRightsRequestRow[] | null;
    notice: ErasureNotice;
    cancellingId: string | null;
    cancel: (id: string) => Promise<void>;
}

async function loadRequests(): Promise<DataRightsRequestRow[]> {
    const res = await apiFetch('/shramsafal/me/erasure/requests', { method: 'GET' });
    if (!res.ok) throw new Error(`erasure list failed: ${res.status}`);
    const body = (await res.json()) as ErasureRequestView[];
    return body.map(r => ({
        id: r.requestId,
        kind: 'erasure' as const,
        status: r.status,
        requestedAtUtc: r.requestedAtUtc,
        completedAtUtc: r.endedAtUtc,
        erasureStartsAtUtc: r.erasureStartsAtUtc,
        mayCancel: r.mayCancel,
        askedByMe: r.askedByMe,
        aboutMe: r.aboutMe ?? true,
    }));
}

/** His waiting request (about his own data), if any: the one the screen shows instead of a new "erase" button. */
export function waitingRequestFor(rows: DataRightsRequestRow[] | null): DataRightsRequestRow | null {
    return rows?.find(r => r.kind === 'erasure' && r.status === 'Requested' && r.aboutMe !== false) ?? null;
}

export function useMyErasureRequests(refreshKey = 0): MyErasureRequests {
    const [rows, setRows] = useState<DataRightsRequestRow[] | null>(null);
    const [notice, setNotice] = useState<ErasureNotice>(null);
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let cancelled = false;
        loadRequests().then(
            list => { if (!cancelled) setRows(list); },
            () => { if (!cancelled) setNotice(n => n ?? 'loadError'); },
        );
        return () => { cancelled = true; };
    }, [refreshKey, tick]);

    const cancel = useCallback(async (id: string) => {
        setCancellingId(id);
        try {
            const res = await apiFetch(`/shramsafal/me/erasure/${id}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            setNotice(res.ok ? 'cancelDone' : res.status === 409 ? 'cancelStarted' : 'cancelError');
        } catch {
            setNotice('cancelError');
        } finally {
            setCancellingId(null);
            setTick(t => t + 1);
        }
    }, []);

    return { rows, notice, cancellingId, cancel };
}
