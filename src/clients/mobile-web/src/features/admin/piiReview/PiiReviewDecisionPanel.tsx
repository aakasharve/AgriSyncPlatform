/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * spec: data-principle-spine-2026-05-05/10.4
 *
 * DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.4 — side-by-side
 * Original / Redacted diff with Approve and Reject buttons. Posts
 * to <c>/shramsafal/admin/pii-review/{id}/approve</c> or
 * <c>/shramsafal/admin/pii-review/{id}/reject</c> (gated by the
 * `"pii_reviewer"` policy).
 */

import React, { useMemo, useState } from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { tPiiReview, toPiiReviewLocale } from '../../../i18n/piiReviewTranslations';
import type { PiiReviewQueueEntryDto } from './PiiReviewQueuePage';

export interface PiiReviewDecisionPanelProps {
    entry: PiiReviewQueueEntryDto;
    onBack: () => void;
    /** Injectable poster so component tests can stub the HTTP call. */
    postDecision?: (
        entryId: string,
        action: 'approve' | 'reject',
        note: string | null,
    ) => Promise<void>;
}

async function defaultPostDecision(
    entryId: string,
    action: 'approve' | 'reject',
    note: string | null,
): Promise<void> {
    const response = await fetch(
        `/shramsafal/admin/pii-review/${entryId}/${action}`,
        {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note }),
        },
    );
    if (!response.ok) {
        throw new Error(`PII review decision failed: ${response.status}`);
    }
}

export const PiiReviewDecisionPanel: React.FC<PiiReviewDecisionPanelProps> = ({
    entry,
    onBack,
    postDecision = defaultPostDecision,
}) => {
    const { language } = useLanguage();
    const locale = useMemo(() => toPiiReviewLocale(language), [language]);

    const [note, setNote] = useState<string>('');
    const [busy, setBusy] = useState<boolean>(false);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [feedbackKind, setFeedbackKind] = useState<'success' | 'error' | null>(null);

    const submit = async (action: 'approve' | 'reject') => {
        setBusy(true);
        setFeedback(null);
        setFeedbackKind(null);
        try {
            await postDecision(entry.id, action, note.trim().length > 0 ? note.trim() : null);
            setFeedback(
                tPiiReview(
                    locale,
                    action === 'approve' ? 'decision.approveSuccess' : 'decision.rejectSuccess',
                ),
            );
            setFeedbackKind('success');
        } catch {
            setFeedback(
                tPiiReview(
                    locale,
                    action === 'approve' ? 'decision.approveError' : 'decision.rejectError',
                ),
            );
            setFeedbackKind('error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <section
            data-testid="pii-review-decision-panel"
            style={{
                fontFamily: "'DM Sans', sans-serif",
                padding: '16px',
            }}
        >
            <h2 style={{ fontFamily: "'DM Sans', sans-serif" }}>
                {tPiiReview(locale, 'decision.title')}
            </h2>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '12px',
                    marginTop: '12px',
                }}
            >
                <div>
                    <h3>{tPiiReview(locale, 'decision.originalLabel')}</h3>
                    <pre
                        data-testid="pii-review-original-text"
                        style={{
                            whiteSpace: 'pre-wrap',
                            fontFamily: "'Noto Sans Devanagari', sans-serif",
                            border: '1px solid #ccc',
                            padding: '8px',
                        }}
                    >
                        {entry.originalText}
                    </pre>
                </div>
                <div>
                    <h3>{tPiiReview(locale, 'decision.redactedLabel')}</h3>
                    <pre
                        data-testid="pii-review-redacted-text"
                        style={{
                            whiteSpace: 'pre-wrap',
                            fontFamily: "'Noto Sans Devanagari', sans-serif",
                            border: '1px solid #ccc',
                            padding: '8px',
                        }}
                    >
                        {entry.redactedText}
                    </pre>
                </div>
            </div>
            <label
                htmlFor="pii-review-note"
                style={{ display: 'block', marginTop: '12px' }}
            >
                <textarea
                    id="pii-review-note"
                    data-testid="pii-review-note-input"
                    rows={3}
                    placeholder={tPiiReview(locale, 'decision.notePlaceholder')}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    style={{ width: '100%' }}
                />
            </label>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button
                    type="button"
                    onClick={() => submit('approve')}
                    disabled={busy}
                    data-testid="pii-review-approve-button"
                >
                    {tPiiReview(locale, 'decision.approveButton')}
                </button>
                <button
                    type="button"
                    onClick={() => submit('reject')}
                    disabled={busy}
                    data-testid="pii-review-reject-button"
                >
                    {tPiiReview(locale, 'decision.rejectButton')}
                </button>
                <button
                    type="button"
                    onClick={onBack}
                    data-testid="pii-review-back-button"
                >
                    {tPiiReview(locale, 'decision.backToQueue')}
                </button>
            </div>
            {feedback && (
                <p
                    role={feedbackKind === 'error' ? 'alert' : 'status'}
                    data-testid={
                        feedbackKind === 'error'
                            ? 'pii-review-decision-error'
                            : 'pii-review-decision-success'
                    }
                >
                    {feedback}
                </p>
            )}
        </section>
    );
};
