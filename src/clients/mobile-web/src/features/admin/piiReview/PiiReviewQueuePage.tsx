/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * spec: data-principle-spine-2026-05-05/10.4
 *
 * DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.4 — admin landing page
 * for the PII review queue. Lists pending entries and routes each
 * row to the <see cref="PiiReviewDecisionPanel"/> for the approve/
 * reject decision.
 *
 * All user-facing strings are tagged with `[LEGAL_REVIEW_PENDING]`
 * via `tPiiReview()` per the Phase 06 OQ-7 convention (binding under
 * DS-015 Track-B).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { tPiiReview, toPiiReviewLocale } from '../../../i18n/piiReviewTranslations';
import { PiiReviewDecisionPanel } from './PiiReviewDecisionPanel';

export interface PiiReviewQueueEntryDto {
    id: string;
    transcriptId: string;
    status: string;
    originalText: string;
    redactedText: string;
    detectionJson: string;
    reviewedByUserId?: string | null;
    reviewNote?: string | null;
    occurredAtUtc: string;
    reviewedAtUtc?: string | null;
}

export interface PiiReviewQueuePageProps {
    /** Injectable fetcher so component tests can stub the API. */
    fetchQueue?: () => Promise<PiiReviewQueueEntryDto[]>;
}

/** Default fetcher hits the backend endpoint defined in PiiReviewEndpoints.cs. */
async function defaultFetchQueue(): Promise<PiiReviewQueueEntryDto[]> {
    const response = await fetch('/shramsafal/admin/pii-review/queue?status=Pending', {
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error(`PII review queue fetch failed: ${response.status}`);
    }
    const body = await response.json();
    return (body?.entries ?? []) as PiiReviewQueueEntryDto[];
}

export const PiiReviewQueuePage: React.FC<PiiReviewQueuePageProps> = ({
    fetchQueue = defaultFetchQueue,
}) => {
    const { language } = useLanguage();
    const locale = useMemo(() => toPiiReviewLocale(language), [language]);

    const [entries, setEntries] = useState<PiiReviewQueueEntryDto[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setError(null);
        try {
            const rows = await fetchQueue();
            setEntries(rows);
        } catch (_e) {
            setError(tPiiReview(locale, 'queue.loadError'));
        }
    }, [fetchQueue, locale]);

    useEffect(() => {
        reload();
    }, [reload]);

    if (selectedEntryId !== null && entries) {
        const selected = entries.find((e) => e.id === selectedEntryId) ?? null;
        if (selected) {
            return (
                <PiiReviewDecisionPanel
                    entry={selected}
                    onBack={() => {
                        setSelectedEntryId(null);
                        reload();
                    }}
                />
            );
        }
    }

    return (
        <main
            data-testid="pii-review-queue-page"
            style={{
                fontFamily: "'DM Sans', sans-serif",
                padding: '16px',
            }}
        >
            <h1 style={{ fontFamily: "'DM Sans', sans-serif" }}>
                {tPiiReview(locale, 'queue.title')}
            </h1>
            {entries === null && !error && (
                <p>{tPiiReview(locale, 'queue.loading')}</p>
            )}
            {error && (
                <p role="alert" data-testid="pii-review-load-error">
                    {error}
                </p>
            )}
            {entries !== null && entries.length === 0 && (
                <p data-testid="pii-review-empty">{tPiiReview(locale, 'queue.empty')}</p>
            )}
            {entries !== null && entries.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th align="left">{tPiiReview(locale, 'queue.listColumns.transcriptId')}</th>
                            <th align="left">{tPiiReview(locale, 'queue.listColumns.score')}</th>
                            <th align="left">{tPiiReview(locale, 'queue.listColumns.occurredAtUtc')}</th>
                            <th align="left">{tPiiReview(locale, 'queue.listColumns.action')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((entry) => (
                            <tr key={entry.id} data-testid={`pii-review-row-${entry.id}`}>
                                <td>{entry.transcriptId}</td>
                                <td>{readScore(entry.detectionJson)}</td>
                                <td>{entry.occurredAtUtc}</td>
                                <td>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedEntryId(entry.id)}
                                        data-testid={`pii-review-open-${entry.id}`}
                                    >
                                        {tPiiReview(locale, 'queue.listColumns.action')}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </main>
    );
};

function readScore(detectionJson: string): string {
    try {
        const parsed = JSON.parse(detectionJson) as { score?: number };
        return typeof parsed.score === 'number' ? parsed.score.toFixed(2) : '-';
    } catch {
        return '-';
    }
}

export default PiiReviewQueuePage;
