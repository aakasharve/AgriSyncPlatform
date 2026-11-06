// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2. The invite builder SENDS THE GRANT IT SHOWS: what the
 * owner sees as chips (the label's starting set, the money answer, his own switch changes) is exactly the body the
 * server receives; the delivery then shows the server's code. Only the network is stubbed.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockCreate = vi.fn();
vi.mock('../personalInvitationClient', async (actual) => ({
    ...(await actual<typeof import('../personalInvitationClient')>()),
    createInvitation: (...a: unknown[]) => mockCreate(...a),
}));

import { InviteBuilderSheet } from '../InviteBuilderSheet';

const view = (body: Record<string, unknown>) => ({
    id: 'inv-1', farmId: 'farm-1', code: '48217730', link: 'https://shramsafal.in/i/48217730', label: body.label,
    name: null, invitedPhoneLast4: null, fieldOperatorId: null, plotScope: body.plotScope, plotIds: [], plotNames: [],
    authorities: body.authorities, status: 'Waiting', createdAtUtc: '2026-11-06T06:00:00Z', expiresAtUtc: '2026-11-13T06:00:00Z',
    claimedByUserId: null, claimedAtUtc: null, waitsForOwner: false, workerLinked: false,
});

beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockImplementation(async (_farm: string, body: Record<string, unknown>) => view(body));
});
afterEach(cleanup);

const shown = () => within(screen.getByTestId('invite-shown-grant')).getAllByRole('listitem').map(li => li.textContent);

describe('the invite builder sends the grant it shows', () => {
    it('कुटुंब: the D-26 set is shown, money "हो" adds it, and the body carries exactly those', async () => {
        render(<InviteBuilderSheet farmId="farm-1" farmName="पाटील फार्म" farmPlots={[]} onClose={vi.fn()} />);

        fireEvent.click(screen.getByTestId('invite-label-Family'));
        expect(shown()).toEqual(['हजेरी घेऊ शकतात', 'नोंदी पक्क्या करू शकतात', 'पैसे दिसत नाहीत']);

        fireEvent.click(screen.getByTestId('invite-money-yes'));
        expect(shown()).toEqual(['हजेरी घेऊ शकतात', 'नोंदी पक्क्या करू शकतात', 'पैसे दिसतात']);

        fireEvent.change(screen.getByTestId('invite-mobile'), { target: { value: '60000 12345' } });
        fireEvent.click(screen.getByTestId('invite-make'));

        await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
        expect(mockCreate).toHaveBeenCalledWith('farm-1', {
            label: 'Family',
            invitedPhone: '6000012345',
            plotScope: 'AllPlots',
            authorities: [
                { name: 'TakeAttendance', expiresAtUtc: null },
                { name: 'ConfirmRecords', expiresAtUtc: null },
                { name: 'SeeMoney', expiresAtUtc: null },
            ],
        });
        expect(await screen.findByTestId('invite-code')).toHaveTextContent('4821-7730');
        expect(screen.getByTestId('invite-show-qr')).toHaveTextContent('समोर आहेत — QR दाखवा');
        expect(screen.getByTestId('invite-send-link')).toHaveTextContent('दूर आहेत — लिंक पाठवा');
    });

    it('"change individual permissions" moves the same grant: a switch taken off is not sent', async () => {
        render(<InviteBuilderSheet farmId="farm-1" farmName="f" farmPlots={[]} onClose={vi.fn()} />);
        fireEvent.click(screen.getByTestId('invite-label-CoOwner'));
        fireEvent.click(screen.getByTestId('invite-change-each'));
        fireEvent.click(screen.getByTestId('authority-ConfirmRecords-invite'));
        expect(shown()).toEqual(['शेताची रचना बदलू शकतात', 'हजेरी घेऊ शकतात', 'पैसे दिसतात']);

        fireEvent.click(screen.getByTestId('invite-make'));
        await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
        const body = mockCreate.mock.calls[0][1] as { label: string; authorities: { name: string }[] };
        expect(body.label).toBe('CoOwner');
        expect(body.authorities.map(a => a.name)).toEqual(['EditFarmSetup', 'TakeAttendance', 'SeeMoney']);
    });

    it('a wrong mobile is not sent; a कामगार starts with his own work and nothing granted', () => {
        render(<InviteBuilderSheet farmId="farm-1" farmName="f" farmPlots={[]} onClose={vi.fn()} />);
        expect(shown()).toEqual(['पैसे दिसत नाहीत']);
        fireEvent.change(screen.getByTestId('invite-mobile'), { target: { value: '12345' } });
        expect(screen.getByTestId('invite-mobile-wrong')).toBeInTheDocument();
        expect(screen.getByTestId('invite-make')).toBeDisabled();
        expect(mockCreate).not.toHaveBeenCalled();
    });
});
