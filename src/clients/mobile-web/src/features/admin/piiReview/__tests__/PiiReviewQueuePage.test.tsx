// @vitest-environment jsdom
// spec: data-principle-spine-2026-05-05/10.4
//
// PiiReviewQueuePage + PiiReviewDecisionPanel render + interaction
// tests. Stubs the fetcher / poster so no IndexedDB or HTTP runtime
// is required.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { PiiReviewQueuePage, PiiReviewQueueEntryDto } from '../PiiReviewQueuePage';
import { PiiReviewDecisionPanel } from '../PiiReviewDecisionPanel';
import { LEGAL_REVIEW_PENDING_PREFIX } from '../../../../i18n/legalReviewMarker';

const sampleEntry: PiiReviewQueueEntryDto = {
    id: 'entry-1',
    transcriptId: 'transcript-1',
    status: 'Pending',
    originalText: 'रामू मजूर आला, सीता पण होती.',
    redactedText: '[WORKER_1] मजूर आला, [WORKER_2] पण होती.',
    detectionJson: '{"score":0.7333,"status":"ReviewQueue","markerCount":1,"nameCount":2}',
    reviewedByUserId: null,
    reviewNote: null,
    occurredAtUtc: '2026-05-21T10:00:00Z',
    reviewedAtUtc: null,
};

afterEach(() => {
    cleanup();
});

describe('PiiReviewQueuePage', () => {
    it('renders the queue title with the legal-review tag', async () => {
        const fetchQueue = vi.fn().mockResolvedValue([sampleEntry]);
        render(<PiiReviewQueuePage fetchQueue={fetchQueue} />);

        await waitFor(() => {
            expect(screen.getByTestId('pii-review-queue-page')).toBeInTheDocument();
        });

        // Title carries the [LEGAL_REVIEW_PENDING] prefix.
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading.textContent).toContain(LEGAL_REVIEW_PENDING_PREFIX);
    });

    it('shows the empty state when the queue returns no entries', async () => {
        const fetchQueue = vi.fn().mockResolvedValue([]);
        render(<PiiReviewQueuePage fetchQueue={fetchQueue} />);

        await waitFor(() => {
            expect(screen.getByTestId('pii-review-empty')).toBeInTheDocument();
        });
    });

    it('renders a row per queue entry', async () => {
        const fetchQueue = vi.fn().mockResolvedValue([sampleEntry]);
        render(<PiiReviewQueuePage fetchQueue={fetchQueue} />);

        await waitFor(() => {
            expect(screen.getByTestId('pii-review-row-entry-1')).toBeInTheDocument();
        });
        expect(screen.getByText('0.73')).toBeInTheDocument();
    });

    it('surfaces a load error when the fetcher throws', async () => {
        const fetchQueue = vi.fn().mockRejectedValue(new Error('boom'));
        render(<PiiReviewQueuePage fetchQueue={fetchQueue} />);

        await waitFor(() => {
            expect(screen.getByTestId('pii-review-load-error')).toBeInTheDocument();
        });
    });
});

describe('PiiReviewDecisionPanel', () => {
    it('renders original and redacted text side by side', () => {
        render(
            <PiiReviewDecisionPanel
                entry={sampleEntry}
                onBack={() => undefined}
                postDecision={vi.fn().mockResolvedValue(undefined)}
            />,
        );

        expect(screen.getByTestId('pii-review-original-text')).toHaveTextContent('रामू');
        expect(screen.getByTestId('pii-review-redacted-text')).toHaveTextContent('[WORKER_1]');
    });

    it('posts the approve decision and shows the success feedback', async () => {
        const postDecision = vi.fn().mockResolvedValue(undefined);
        render(
            <PiiReviewDecisionPanel
                entry={sampleEntry}
                onBack={() => undefined}
                postDecision={postDecision}
            />,
        );

        fireEvent.click(screen.getByTestId('pii-review-approve-button'));

        await waitFor(() => {
            expect(screen.getByTestId('pii-review-decision-success')).toBeInTheDocument();
        });
        expect(postDecision).toHaveBeenCalledWith('entry-1', 'approve', null);
    });

    it('threads the reviewer note into the reject post body', async () => {
        const postDecision = vi.fn().mockResolvedValue(undefined);
        render(
            <PiiReviewDecisionPanel
                entry={sampleEntry}
                onBack={() => undefined}
                postDecision={postDecision}
            />,
        );

        fireEvent.change(screen.getByTestId('pii-review-note-input'), {
            target: { value: 'false positive' },
        });
        fireEvent.click(screen.getByTestId('pii-review-reject-button'));

        await waitFor(() => {
            expect(screen.getByTestId('pii-review-decision-success')).toBeInTheDocument();
        });
        expect(postDecision).toHaveBeenCalledWith('entry-1', 'reject', 'false positive');
    });

    it('surfaces an error message when the post fails', async () => {
        const postDecision = vi.fn().mockRejectedValue(new Error('boom'));
        render(
            <PiiReviewDecisionPanel
                entry={sampleEntry}
                onBack={() => undefined}
                postDecision={postDecision}
            />,
        );

        fireEvent.click(screen.getByTestId('pii-review-approve-button'));

        await waitFor(() => {
            expect(screen.getByTestId('pii-review-decision-error')).toBeInTheDocument();
        });
    });
});
