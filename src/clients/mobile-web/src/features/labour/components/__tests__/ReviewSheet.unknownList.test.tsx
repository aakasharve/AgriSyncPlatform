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

const DONE_TITLE = 'सगळ्या नोंदी तपासून झाल्या';
const DONE_HEADER = 'सगळं झालं ✓';

describe('ReviewSheet - empty list', () => {
    it('a genuinely empty, KNOWN list still says everything is checked', () => {
        render(<ReviewSheet open data={EMPTY_LABOUR_DATA} onClose={() => undefined} onToast={() => undefined} />);
        expect(screen.getByText(DONE_TITLE)).toBeInTheDocument();
        expect(screen.getByText(DONE_HEADER)).toBeInTheDocument();
    });

    it('an UNKNOWN list (offline / stale) never claims completeness', () => {
        render(<ReviewSheet open data={EMPTY_LABOUR_DATA} reviewListUnknown onClose={() => undefined} onToast={() => undefined} />);
        expect(screen.queryByText(DONE_TITLE)).not.toBeInTheDocument();
        expect(screen.queryByText(DONE_HEADER)).not.toBeInTheDocument();
        expect(screen.getByTestId('review-list-unknown')).toBeInTheDocument();
    });
});
