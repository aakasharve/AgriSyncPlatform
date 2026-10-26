// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1, F2) — a person whose only seats grant nothing yet
 * has no farm, so the 0-farm screen stays open. It must say what each seat is (in Marathi), never
 * one thing for another:
 *   - a typed-code request still waiting for the owner — and it can be WITHDRAWN here (M1: before,
 *     no screen offered that, although the server always accepts it);
 *   - a paused seat — "work paused", never "request sent" (m2), and no withdraw button.
 * Without such a seat the screen is unchanged.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../qr/inviteApi', () => ({
    bootstrapFirstFarm: vi.fn(),
    isInviteApiError: () => false,
}));

import MinimalOnboarding from '../MinimalOnboarding';

afterEach(cleanup);

const REQUEST = { farmId: 'f-req', name: 'पवार शेती', status: 'PendingApproval' };
const PAUSED = { farmId: 'f-paused', name: 'जाधव मळा', status: 'Suspended' };

describe('MinimalOnboarding with seats that grant nothing yet', () => {
    it('says each request is waiting for the owner, in Marathi', () => {
        render(
            <MinimalOnboarding
                isOpen
                onComplete={vi.fn()}
                onJoinViaQr={vi.fn()}
                pendingSeats={[REQUEST]}
                onWithdrawRequest={vi.fn()}
            />,
        );
        const note = screen.getByTestId('minimal-onboarding-pending');
        expect(note).toHaveTextContent('पवार शेती');
        expect(note).toHaveTextContent('मंजुरीची वाट');
        expect(note.textContent).not.toMatch(/[A-Za-z]{3,}/);
    });

    it('a waiting request can be withdrawn from here (server self-exit for THAT farm)', async () => {
        const withdraw = vi.fn().mockResolvedValue(undefined);
        render(
            <MinimalOnboarding
                isOpen
                onComplete={vi.fn()}
                onJoinViaQr={vi.fn()}
                pendingSeats={[REQUEST]}
                onWithdrawRequest={withdraw}
            />,
        );
        fireEvent.click(screen.getByTestId('withdraw-request-f-req'));
        await waitFor(() => expect(withdraw).toHaveBeenCalledWith('f-req'));
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a refused withdraw says so in Marathi and keeps the request listed', async () => {
        const withdraw = vi.fn().mockRejectedValue(new Error('offline'));
        render(
            <MinimalOnboarding
                isOpen
                onComplete={vi.fn()}
                onJoinViaQr={vi.fn()}
                pendingSeats={[REQUEST]}
                onWithdrawRequest={withdraw}
            />,
        );
        fireEvent.click(screen.getByTestId('withdraw-request-f-req'));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('मागे घेता आलं नाही');
        expect(alert.textContent).not.toMatch(/[A-Za-z]{3,}/);
        expect(screen.getByTestId('pending-seat-f-req')).toBeInTheDocument();
    });

    it('a paused seat says "work paused" — never "request sent" — and offers no withdraw', () => {
        render(
            <MinimalOnboarding
                isOpen
                onComplete={vi.fn()}
                onJoinViaQr={vi.fn()}
                pendingSeats={[PAUSED]}
                onWithdrawRequest={vi.fn()}
            />,
        );
        const seat = screen.getByTestId('pending-seat-f-paused');
        expect(seat).toHaveTextContent('जाधव मळा');
        expect(seat).toHaveTextContent('काम थांबवलं आहे');
        expect(seat).not.toHaveTextContent('विनंती');
        expect(screen.queryByTestId('withdraw-request-f-paused')).toBeNull();
    });

    it('draws no withdraw button when nothing can withdraw (no control that cannot act)', () => {
        render(<MinimalOnboarding isOpen onComplete={vi.fn()} onJoinViaQr={vi.fn()} pendingSeats={[REQUEST]} />);
        expect(screen.getByTestId('pending-seat-f-req')).toHaveTextContent('मंजुरीची वाट');
        expect(screen.queryByTestId('withdraw-request-f-req')).toBeNull();
    });

    it('shows no note without such a seat (unchanged screen)', () => {
        render(<MinimalOnboarding isOpen onComplete={vi.fn()} onJoinViaQr={vi.fn()} />);
        expect(screen.queryByTestId('minimal-onboarding-pending')).toBeNull();
    });
});
