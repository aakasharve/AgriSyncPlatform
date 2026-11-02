// spec: data-principle-spine-2026-05-05/08.6
//
// In-flight + completed data-rights requests list. Renders both
// erasure + export requests with download links for completed exports.
// Pure render component — caller injects the list. The erasure rows come from
// GET /shramsafal/me/erasure/requests (MyErasureRequests); no export listing
// route exists yet.
//
// spec: plr-d10 lane F99 fix pass 1, item 11 (founder D-71) — a waiting erasure
// request shows the day erasure starts and a cancel action; every server state
// has its words (the union was the original four, and a fifth or sixth value
// would have rendered nothing); the kind is said in his language, not as the
// raw English "erasure".

import React from 'react';
import {
    formatDataRightsDate,
    tDataRights,
    type DataRightsLocale,
} from '../../i18n/dataRightsTranslations';

export type DataRightsRequestStatus =
    | 'Requested' | 'InProgress' | 'Completed' | 'CompletedWithResidue' | 'Failed' | 'Cancelled';

export interface DataRightsRequestRow {
    id: string;
    kind: 'erasure' | 'export';
    status: DataRightsRequestStatus;
    requestedAtUtc: string;
    completedAtUtc?: string | null;
    presignedUrl?: string | null;
    /** D-71 — when erasure starts (the server's date). */
    erasureStartsAtUtc?: string | null;
    /** D-71 — the server says this reader may cancel it now (waiting, and he asked for it). */
    mayCancel?: boolean;
    /** False when someone else (ShramSafal) asked for it on his behalf. */
    askedByMe?: boolean;
    /** fix pass 2 (N-6): false when the reader filed it for SOMEONE ELSE's data (the platform admin's own list). */
    aboutMe?: boolean;
}

interface Props {
    requests: DataRightsRequestRow[];
    locale: DataRightsLocale;
    /** D-71 — cancel a waiting request. No handler, no button. */
    onCancel?: (id: string) => void;
    /** The request whose cancel is being sent (its button is disabled meanwhile). */
    cancellingId?: string | null;
}

const RecentRequestsList: React.FC<Props> = ({ requests, locale, onCancel, cancellingId = null }) => {
    const title = tDataRights(locale, 'recent.title');
    const empty = tDataRights(locale, 'recent.empty');
    const downloadLabel = tDataRights(locale, 'export.downloadLabel');
    const cancelLabel = tDataRights(locale, 'recent.cancelAction');

    const statusFor = (r: DataRightsRequestRow): string => {
        switch (r.status) {
            case 'Requested': {
                const date = formatDataRightsDate(locale, r.erasureStartsAtUtc);
                return r.kind === 'erasure' && date
                    ? tDataRights(locale, 'recent.statusWaiting').replace('{date}', date)
                    : tDataRights(locale, 'recent.statusRequested');
            }
            case 'InProgress': return tDataRights(locale, 'recent.statusInProgress');
            case 'Completed': return tDataRights(locale, 'recent.statusCompleted');
            case 'CompletedWithResidue': return tDataRights(locale, 'recent.statusCompletedWithResidue');
            case 'Failed': return tDataRights(locale, 'recent.statusFailed');
            case 'Cancelled': return tDataRights(locale, 'recent.statusCancelled');
            default: return tDataRights(locale, 'recent.statusRequested');
        }
    };

    return (
        <div
            className="space-y-3"
            data-testid="recent-requests-list"
            data-data-rights-locale={locale}
        >
            <h3 className="text-lg font-display font-black text-stone-800 px-1">{title}</h3>

            {requests.length === 0 ? (
                <p className="text-sm text-stone-500 px-1" data-testid="recent-requests-empty">
                    {empty}
                </p>
            ) : (
                <ul className="space-y-2">
                    {requests.map(r => (
                        <li
                            key={r.id}
                            className="glass-panel p-3 flex justify-between items-center"
                            data-testid={`recent-request-${r.id}`}
                        >
                            <div>
                                <p className="text-sm font-bold text-stone-800">
                                    {tDataRights(locale, r.kind !== 'erasure'
                                        ? 'recent.kindExport'
                                        : r.aboutMe === false ? 'recent.kindErasureForOther' : 'recent.kindErasure')}
                                </p>
                                <p className="text-xs text-stone-500" data-testid={`recent-request-status-${r.id}`}>{statusFor(r)}</p>
                                {r.askedByMe === false && r.aboutMe !== false && (
                                    <p className="text-xs text-stone-500">{tDataRights(locale, 'recent.askedOnBehalf')}</p>
                                )}
                            </div>
                            {r.kind === 'erasure' && r.mayCancel && onCancel && (
                                <button
                                    type="button"
                                    onClick={() => onCancel(r.id)}
                                    disabled={cancellingId === r.id}
                                    className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-black text-red-700 ring-1 ring-red-300 disabled:opacity-60"
                                    data-testid={`recent-request-cancel-${r.id}`}
                                >
                                    {cancelLabel}
                                </button>
                            )}
                            {r.presignedUrl && r.kind === 'export' && (
                                <a
                                    href={r.presignedUrl}
                                    className="text-xs font-black text-emerald-700 underline"
                                    data-testid={`recent-request-download-${r.id}`}
                                >
                                    {downloadLabel}
                                </a>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default RecentRequestsList;
