// spec: data-principle-spine-2026-05-05/08.6
//
// In-flight + completed data-rights requests list. Renders both
// erasure + export requests with download links for completed exports.
// Pure render component — caller injects the list (the parent screen
// fetches from /shramsafal/me/erasure/* and /shramsafal/me/export/*
// which Phase 12+ wires once the listing endpoints land).

import React from 'react';
import {
    tDataRights,
    type DataRightsLocale,
} from '../../i18n/dataRightsTranslations';

export interface DataRightsRequestRow {
    id: string;
    kind: 'erasure' | 'export';
    status: 'Requested' | 'InProgress' | 'Completed' | 'Failed';
    requestedAtUtc: string;
    completedAtUtc?: string | null;
    presignedUrl?: string | null;
}

interface Props {
    requests: DataRightsRequestRow[];
    locale: DataRightsLocale;
}

const RecentRequestsList: React.FC<Props> = ({ requests, locale }) => {
    const title = tDataRights(locale, 'recent.title');
    const empty = tDataRights(locale, 'recent.empty');
    const downloadLabel = tDataRights(locale, 'export.downloadLabel');

    const statusFor = (s: DataRightsRequestRow['status']) => {
        switch (s) {
            case 'Requested': return tDataRights(locale, 'recent.statusRequested');
            case 'InProgress': return tDataRights(locale, 'recent.statusInProgress');
            case 'Completed': return tDataRights(locale, 'recent.statusCompleted');
            case 'Failed': return tDataRights(locale, 'recent.statusFailed');
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
                                <p className="text-sm font-bold text-stone-800">{r.kind}</p>
                                <p className="text-xs text-stone-500">{statusFor(r.status)}</p>
                            </div>
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
