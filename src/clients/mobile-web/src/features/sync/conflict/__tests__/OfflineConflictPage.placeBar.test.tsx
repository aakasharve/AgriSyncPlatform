// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I17, H19 / PLR-D9 T1-T2) — the not-synced page (opened
// from the header's badge) has the one title bar with one big मागे (it was an English "← Back") and says
// things once, in Marathi (the English copies "(Retry)", "(Discard)", "No conflicts…" are gone).
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OfflineConflictPage from '../OfflineConflictPage';
import { ConflictResolutionService } from '../ConflictResolutionService';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

vi.mock('../ConflictResolutionService', () => ({
    ConflictResolutionService: { list: vi.fn(), retry: vi.fn(), discard: vi.fn() },
}));
const service = ConflictResolutionService as unknown as { list: ReturnType<typeof vi.fn> };

describe('OfflineConflictPage — one title bar, Marathi once', () => {
    beforeEach(() => vi.resetAllMocks());
    afterEach(() => cleanup());

    it('empty: title bar with मागे that goes back, and no English line', async () => {
        service.list.mockResolvedValue([]);
        const onBack = vi.fn();
        render(<OfflineConflictPage onBack={onBack} />);
        const empty = await screen.findByTestId('conflict-empty');
        expect(screen.getByTestId('page-title')).toHaveTextContent('सिंक न झालेल्या नोंदी');
        expect(empty.textContent ?? '').not.toMatch(/[A-Za-z]/);
        fireEvent.click(screen.getByTestId('page-back'));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('a list that could not be read is NOT "all synced" (P4): it says it could not be opened', async () => {
        service.list.mockRejectedValue(new Error('IndexedDB is closed'));
        render(<OfflineConflictPage onBack={vi.fn()} />);
        const failed = await screen.findByTestId('conflict-read-failed');
        expect(failed).toHaveTextContent('या नोंदी आत्ता उघडता आल्या नाहीत.');
        expect(screen.queryByTestId('conflict-empty')).toBeNull();
        expect(screen.queryByText('सर्व नोंदी सिंक झाल्या आहेत.')).toBeNull();
        // the raw English error never reaches the farmer
        expect(failed.textContent ?? '').not.toMatch(/[A-Za-z]/);
        expect(screen.getAllByTestId('page-back')).toHaveLength(1);
    });

    it('a retry that fails says so in Marathi, not with the raw English error', async () => {
        service.list.mockResolvedValue([{
            mutationId: 'm1', mutationType: SyncMutationName.CreateDailyLog, capturedAt: '2026-04-01T10:00:00Z',
            reason: 'X', hint: undefined, payloadPreview: '{}',
        }]);
        (ConflictResolutionService as unknown as { retry: ReturnType<typeof vi.fn> }).retry.mockRejectedValue(new Error('network down'));
        render(<OfflineConflictPage onBack={vi.fn()} />);
        fireEvent.click(await screen.findByTestId('retry-m1'));
        const error = await screen.findByTestId('conflict-error');
        expect(error).toHaveTextContent('हे झालं नाही. पुन्हा प्रयत्न करा.');
        expect(error.textContent ?? '').not.toMatch(/network/);
        // the row is still there: nothing was lost
        expect(screen.getByTestId('conflict-row-m1')).toBeInTheDocument();
    });

    it('list: the count sits in the title, and the buttons say each thing once', async () => {
        service.list.mockResolvedValue([{
            mutationId: 'm1', mutationType: SyncMutationName.CreateDailyLog, capturedAt: '2026-04-01T10:00:00Z',
            reason: 'X', hint: undefined, payloadPreview: '{}',
        }]);
        render(<OfflineConflictPage onBack={vi.fn()} />);
        expect(await screen.findByTestId('retry-m1')).toHaveTextContent(/^पुन्हा प्रयत्न करा$/);
        expect(screen.getByTestId('discard-m1')).toHaveTextContent(/^काढून टाका$/);
        expect(screen.getByTestId('page-title')).toHaveTextContent('सिंक न झालेल्या नोंदी (1)');
        expect(screen.queryByText(/need your attention|← Back/)).toBeNull();
        expect(screen.getAllByTestId('page-back')).toHaveLength(1);
    });
});
