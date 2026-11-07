// @vitest-environment jsdom
/**
 * ReviewSheet - never claim "all checked" when the list is UNKNOWN.
 *
 * Offline browser proof (2026-10-11): the hub said "tapasa 74" while the sheet
 * (review list stripped from the cached read-out) said "sagla jhala / tapasayla
 * kahi urla nahi". An empty list that we could not fetch is not an empty list.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: vi.fn() },
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn() },
}));

import ReviewSheet from '../ReviewSheet';
import { EMPTY_LABOUR_DATA } from '../../labourMock';

afterEach(() => cleanup());

// lane L4b (founder D-40 §6) — the one empty line, in the header and the body; never "सगळं झालं".
const EMPTY = 'मंजुरीसाठी नोंदी बाकी नाहीत';

describe('ReviewSheet - empty list', () => {
    it('a genuinely empty, KNOWN list says nothing is waiting for approval', () => {
        render(<ReviewSheet open data={EMPTY_LABOUR_DATA} onClose={() => undefined} onToast={() => undefined} />);
        expect(screen.getByTestId('review-list-empty')).toHaveTextContent(EMPTY);
        expect(screen.getByTestId('review-sheet-count')).toHaveTextContent(EMPTY);
    });

    it('an UNKNOWN list (offline / stale) never claims completeness', () => {
        render(<ReviewSheet open data={EMPTY_LABOUR_DATA} reviewListUnknown onClose={() => undefined} onToast={() => undefined} />);
        expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
        expect(screen.getByTestId('review-list-unknown')).toBeInTheDocument();
    });
});

describe('ReviewSheet - list refetching after a save', () => {
    it('never renders the all-done text or the header claim while the list is loading', () => {
        render(<ReviewSheet open data={EMPTY_LABOUR_DATA} reviewListLoading onClose={() => undefined} onToast={() => undefined} />);
        expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
        expect(screen.queryByTestId('review-list-unknown')).not.toBeInTheDocument();
    });

    it('once the refetch settles with a truly empty list the empty line returns', () => {
        const { rerender } = render(<ReviewSheet open data={EMPTY_LABOUR_DATA} reviewListLoading onClose={() => undefined} onToast={() => undefined} />);
        rerender(<ReviewSheet open data={EMPTY_LABOUR_DATA} reviewListLoading={false} onClose={() => undefined} onToast={() => undefined} />);
        expect(screen.getByTestId('review-list-empty')).toHaveTextContent(EMPTY);
    });
});
