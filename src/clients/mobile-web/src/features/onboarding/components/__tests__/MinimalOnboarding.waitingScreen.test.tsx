// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A; R1 joining design rule 3) — THE WAITING
 * SCREEN of a person whose request to join a farm waits for its owner:
 *   - each waiting farm is said by the name the server sent ("‹शेत› च्या मालकाकडे तुमची विनंती गेली आहे…"), and the two
 *     doors are not drawn;
 *   - for the first 2 days, only that; after 2 days (from the SERVER's time of the request) the own-farm offer appears,
 *     its button opens the create-farm form, and the request keeps waiting (its withdraw is still there);
 *   - a request with no time from the server (an older server) keeps today's screen: the doors stay (never stuck, P9);
 *   - "नाही, मी स्वतः सुरू करतोय" before sign-in opens straight on the create-farm form.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../qr/inviteApi', () => ({
    bootstrapFirstFarm: vi.fn(),
    isInviteApiError: () => false,
}));
vi.mock('../../../invitations/WaitingInvitations', () => ({ WaitingInvitations: () => null }));

import MinimalOnboarding from '../MinimalOnboarding';
import { OWN_FARM_OFFER_AFTER_MS } from '../../joinStart/OwnFarmOffer';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const sentAgo = (ms: number) => new Date(NOW - ms).toISOString();
const request = (requestedAtUtc?: string) => ({ farmId: 'f-req', name: 'पवार शेती', status: 'PendingApproval', requestedAtUtc });

function renderWith(seats: Array<ReturnType<typeof request>>, extra: Partial<React.ComponentProps<typeof MinimalOnboarding>> = {}) {
    render(<MinimalOnboarding isOpen onComplete={vi.fn()} onJoinViaQr={vi.fn()} pendingSeats={seats} onWithdrawRequest={vi.fn()} {...extra} />);
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('the waiting screen', () => {
    it('the first 2 days: the farm named by the server, no doors, no offer; the withdraw stays', () => {
        renderWith([request(sentAgo(30 * HOUR))]);
        expect(screen.getByTestId('first-farm-waiting-f-req'))
            .toHaveTextContent('पवार शेती च्या मालकाकडे तुमची विनंती गेली आहे. मालक मंजूर करतील तेव्हा शेत उघडेल.');
        expect(screen.queryByTestId('door-own-farm')).toBeNull();
        expect(screen.queryByTestId('door-invited')).toBeNull();
        expect(screen.queryByTestId('own-farm-offer')).toBeNull();
        expect(screen.getByTestId('withdraw-request-f-req')).toBeInTheDocument();
    });

    it('after 2 days: "तुमचं स्वतःचं शेत आहे का? ते जोडा" with the create button; the request keeps waiting', () => {
        renderWith([request(sentAgo(OWN_FARM_OFFER_AFTER_MS + HOUR))]);
        const offer = screen.getByTestId('own-farm-offer');
        expect(offer).toHaveTextContent('तुमचं स्वतःचं शेत आहे का? ते जोडा');
        expect(offer).toHaveTextContent('तुमची विनंती तशीच वाट पाहत राहील.');
        expect(screen.getByTestId('first-farm-waiting-f-req')).toBeInTheDocument();
        expect(screen.getByTestId('withdraw-request-f-req')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('own-farm-offer-start'));
        expect(screen.getByTestId('first-farm-create')).toBeInTheDocument();
    });

    it('the screen left open across the 2-day mark shows the offer when it comes', () => {
        renderWith([request(sentAgo(OWN_FARM_OFFER_AFTER_MS - 30 * 1000))]);
        expect(screen.queryByTestId('own-farm-offer')).toBeNull();
        act(() => { vi.advanceTimersByTime(61 * 1000); });
        expect(screen.getByTestId('own-farm-offer')).toBeInTheDocument();
    });

    it('no time from the server (an older server): today\'s screen - the waiting card above the two doors', () => {
        renderWith([request(undefined)]);
        expect(screen.getByTestId('first-farm-waiting')).toHaveTextContent('विनंती पाठवली');
        expect(screen.getByTestId('door-own-farm')).toBeInTheDocument();
        expect(screen.getByTestId('door-invited')).toBeInTheDocument();
        expect(screen.queryByTestId('own-farm-offer')).toBeNull();
    });

    it('a paused seat alone is not a waiting request: the doors stay as today', () => {
        render(<MinimalOnboarding isOpen onComplete={vi.fn()} onJoinViaQr={vi.fn()} pendingSeats={[{ farmId: 'f-p', name: 'जाधव मळा', status: 'Suspended' }]} />);
        expect(screen.getByTestId('door-own-farm')).toBeInTheDocument();
        expect(screen.queryByTestId('own-farm-offer')).toBeNull();
    });
});

describe('his own farm first', () => {
    it('"नाही, मी स्वतः सुरू करतोय" before sign-in: the 0-farm screen opens on the create-farm form; its back returns to the doors', () => {
        render(<MinimalOnboarding isOpen onComplete={vi.fn()} onJoinViaQr={vi.fn()} openOnCreate />);
        expect(screen.getByTestId('first-farm-create')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'मागे' }));
        expect(screen.getByTestId('first-farm-doors')).toBeInTheDocument();
    });

    it('without it: the two doors, as today', () => {
        render(<MinimalOnboarding isOpen onComplete={vi.fn()} onJoinViaQr={vi.fn()} />);
        expect(screen.getByTestId('first-farm-doors')).toBeInTheDocument();
    });
});
