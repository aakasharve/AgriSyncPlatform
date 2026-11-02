// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1, item 11 (founder D-71, 2026-11-02).
//
// His erasure requests, from the server (GET /shramsafal/me/erasure/requests): a waiting one shows the day erasure
// starts and "विनंती रद्द करा"; the cancel is POST /shramsafal/me/erasure/{id}/cancel. The server decides: 200 =
// cancelled (nothing erased), 409 = it has already started (said so, not as a failure), anything else = could not.

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../infrastructure/api/apiFetch';
import { tDataRights, type DataRightsLocale } from '../../i18n/dataRightsTranslations';
import RecentRequestsList, { type DataRightsRequestRow, type DataRightsRequestStatus } from './RecentRequestsList';

interface ErasureRequestView {
    requestId: string;
    status: DataRightsRequestStatus;
    requestedAtUtc: string;
    erasureStartsAtUtc: string | null;
    endedAtUtc: string | null;
    mayCancel: boolean;
    askedByMe: boolean;
}

type Notice = 'cancelDone' | 'cancelStarted' | 'cancelError' | 'loadError' | null;

interface Props {
    locale: DataRightsLocale;
    /** Changes when a new request was just made, so the list is read again. */
    refreshKey?: number;
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
    }));
}

const MyErasureRequests: React.FC<Props> = ({ locale, refreshKey = 0 }) => {
    const [rows, setRows] = useState<DataRightsRequestRow[] | null>(null);
    const [notice, setNotice] = useState<Notice>(null);
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

    return (
        <div className="space-y-2" data-testid="my-erasure-requests">
            {notice && (
                <p
                    className={`text-sm font-bold ${notice === 'cancelDone' ? 'text-emerald-800' : 'text-red-700'}`}
                    role="status"
                    data-testid={`erasure-notice-${notice}`}
                >
                    {tDataRights(locale, `recent.${notice}`)}
                </p>
            )}
            {rows && (
                <RecentRequestsList requests={rows} locale={locale} onCancel={cancel} cancellingId={cancellingId} />
            )}
        </div>
    );
};

export default MyErasureRequests;
