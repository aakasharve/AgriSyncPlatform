/**
 * Sub-plan 04 Task 5 — OfflineConflictPage rendering + retry/discard flow.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OfflineConflictPage from '../OfflineConflictPage';
import { ConflictResolutionService } from '../ConflictResolutionService';

vi.mock('../ConflictResolutionService', () => ({
    ConflictResolutionService: {
        list: vi.fn(),
        retry: vi.fn(),
        discard: vi.fn(),
    },
}));

const mockedService = ConflictResolutionService as unknown as {
    list: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
    discard: ReturnType<typeof vi.fn>;
};

describe('OfflineConflictPage', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('shows the loading then empty state when no conflicts exist', async () => {
        mockedService.list.mockResolvedValue([]);
        render(<OfflineConflictPage />);
        expect(await screen.findByTestId('conflict-empty')).toBeInTheDocument();
        expect(screen.getByText(/सर्व नोंदी सिंक झाल्या आहेत/)).toBeInTheDocument();
    });

    it('lists rows and retries the targeted mutation on click', async () => {
        mockedService.list.mockResolvedValue([
            {
                mutationId: 'm1',
                mutationType: 'create_daily_log',
                capturedAt: '2026-04-01T10:00:00Z',
                reason: 'CLIENT_TOO_OLD',
                hint: 'अॅप अपडेट करा',
                payloadPreview: '{"farmId":"f1"}',
            },
            {
                mutationId: 'm2',
                mutationType: 'verify_log_v2',
                capturedAt: '2026-04-01T10:05:00Z',
                reason: 'NO_RESULT',
                hint: undefined,
                payloadPreview: '{"logId":"l2"}',
            },
        ]);
        mockedService.retry.mockResolvedValue(undefined);

        render(<OfflineConflictPage />);
        const retry = await screen.findByTestId('retry-m1');
        await userEvent.click(retry);

        await waitFor(() => {
            expect(mockedService.retry).toHaveBeenCalledWith('m1');
        });
        // Row m1 disappears optimistically; m2 remains.
        await waitFor(() => {
            expect(screen.queryByTestId('conflict-row-m1')).not.toBeInTheDocument();
        });
        expect(screen.getByTestId('conflict-row-m2')).toBeInTheDocument();
    });

    it('discards a row and removes it from the list', async () => {
        mockedService.list.mockResolvedValue([
            {
                mutationId: 'mx',
                mutationType: 'create_plot',
                capturedAt: '2026-04-01T10:00:00Z',
                reason: 'X',
                hint: undefined,
                payloadPreview: '{}',
            },
        ]);
        mockedService.discard.mockResolvedValue(undefined);

        render(<OfflineConflictPage />);
        const discard = await screen.findByTestId('discard-mx');
        await userEvent.click(discard);

        await waitFor(() => {
            expect(mockedService.discard).toHaveBeenCalledWith('mx');
        });
        await waitFor(() => {
            expect(screen.queryByTestId('conflict-row-mx')).not.toBeInTheDocument();
        });
    });
});
