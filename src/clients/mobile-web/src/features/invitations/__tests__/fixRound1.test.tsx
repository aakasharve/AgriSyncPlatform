// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2, fix round 1 (the independent review). The owner's sent
 * list says WHO claimed an invitation and never offers a one-tap let-in to someone the link only reached (H-1); a claim
 * that ended without the owner's yes never reads "स्वीकारलं" (L-4); a refused worker link is said plainly (L-6); the
 * invited person's refusals are worded by their error code (L-2); an authority that does nothing on the grant is never
 * sent and never shown (M-2). Only the network is stubbed.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ lang: null as 'mr' | 'en' | null }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => (h.lang ? { language: h.lang, setLanguage: () => undefined, t: (k: string) => k } : undefined),
}));
const mockList = vi.fn();
const mockApprove = vi.fn();
const mockAccept = vi.fn();
vi.mock('../personalInvitationClient', async (actual) => ({
    ...(await actual<typeof import('../personalInvitationClient')>()),
    listInvitations: (...a: unknown[]) => mockList(...a),
    approveInvitationClaim: (...a: unknown[]) => mockApprove(...a),
    acceptInvitation: (...a: unknown[]) => mockAccept(...a),
}));

import { SentInvitations } from '../SentInvitations';
import { InvitationCard } from '../InvitationCard';
import { INVITATION_COPY_FOR_TESTS } from '../invitationCopy';
import { cardLines, createBody, presetGrant, withAuthorities, withPlots } from '../invitationModel';
import {
    invitationRefusal, type ClaimOutcome, type InvitationCard as Card, type PersonalInvitationView,
} from '../personalInvitationClient';

const sent = (over: Partial<PersonalInvitationView> & Record<string, unknown> = {}): PersonalInvitationView => ({
    id: 'inv-1',
    farmId: 'farm-1',
    code: '48217730',
    link: 'https://shramsafal.in/i/48217730',
    label: 'CoOwner',
    name: 'रमेश',
    invitedPhoneLast4: '2345',
    fieldOperatorId: null,
    plotScope: 'AllPlots',
    plotIds: [],
    plotNames: [],
    authorities: [{ name: 'SeeMoney', expiresAtUtc: null }],
    status: 'Accepted',
    createdAtUtc: '2026-11-06T06:00:00Z',
    expiresAtUtc: '2026-11-13T06:00:00Z',
    claimedByUserId: 'user-suresh',
    claimedAtUtc: '2026-11-06T07:00:00Z',
    waitsForOwner: true,
    workerLinked: false,
    ...over,
} as PersonalInvitationView);

beforeEach(() => { h.lang = null; mockList.mockReset(); mockApprove.mockReset(); mockAccept.mockReset(); });
afterEach(cleanup);

describe('H-1: a forwarded link', () => {
    it('names both the person it was for and the one who opened it, and offers the request card instead of "आत घ्या"', async () => {
        mockList.mockResolvedValue([sent({
            claimedByName: 'Suresh', claimedByPhoneLast4: '4321', claimedByAnotherNumber: true, claimOutcome: 'WaitsForOwner',
        })]);
        const onOpenRequest = vi.fn();
        render(<SentInvitations farmId="farm-1" onShowAgain={vi.fn()} onOpenRequest={onOpenRequest} />);

        expect(await screen.findByTestId('sent-claimed-by-inv-1'))
            .toHaveTextContent('हे आमंत्रण रमेश साठी होतं; Suresh · …4321 यांनी उघडलं');
        expect(screen.queryByTestId('sent-let-in-inv-1')).toBeNull();
        fireEvent.click(screen.getByTestId('sent-open-request-inv-1'));
        expect(onOpenRequest).toHaveBeenCalledWith('user-suresh');
        expect(mockApprove).not.toHaveBeenCalled();
    });

    it('English mode says it in English only', async () => {
        h.lang = 'en';
        mockList.mockResolvedValue([sent({
            claimedByName: 'Suresh', claimedByPhoneLast4: '4321', claimedByAnotherNumber: true, claimOutcome: 'WaitsForOwner',
        })]);
        render(<SentInvitations farmId="farm-1" onShowAgain={vi.fn()} onOpenRequest={vi.fn()} />);
        expect(await screen.findByTestId('sent-claimed-by-inv-1'))
            .toHaveTextContent('This invitation was for रमेश; Suresh · …4321 opened it');
    });

    it('the named person himself (an owner stop made him wait) keeps the one tap, with his own name shown', async () => {
        mockList.mockResolvedValue([sent({
            claimedByName: 'Ramesh', claimedByPhoneLast4: '2345', claimedByAnotherNumber: false, claimOutcome: 'WaitsForOwner',
        })]);
        render(<SentInvitations farmId="farm-1" onShowAgain={vi.fn()} onOpenRequest={vi.fn()} />);
        expect(await screen.findByTestId('sent-let-in-inv-1')).toBeInTheDocument();
        expect(screen.queryByTestId('sent-open-request-inv-1')).toBeNull();
    });
});

describe('L-4: a claim that ended without the owner', () => {
    it.each<[ClaimOutcome, string]>([
        ['Declined', 'नाकारलं'],
        ['Withdrawn', 'मागे घेतलं'],
        ['Joined', 'स्वीकारलं'],
    ])('outcome %s reads "%s"', async (claimOutcome, word) => {
        mockList.mockResolvedValue([sent({
            waitsForOwner: false, claimOutcome, claimedByName: 'Suresh', claimedByPhoneLast4: '4321', claimedByAnotherNumber: true,
        })]);
        render(<SentInvitations farmId="farm-1" onShowAgain={vi.fn()} onOpenRequest={vi.fn()} />);
        expect(await screen.findByTestId('sent-status')).toHaveTextContent(new RegExp(`^${word}$`));
        expect(screen.queryByTestId('sent-let-in-inv-1')).toBeNull();
    });
});

const card = (over: Partial<Card> = {}): Card => ({
    invitationId: 'inv-1',
    farmName: 'पाटील फार्म',
    invitedByName: 'रामराव',
    label: 'Worker',
    name: 'रमेश',
    plotScope: 'OwnWork',
    plotNames: [],
    authorities: [],
    expiresAtUtc: '2026-11-13T06:00:00Z',
    status: 'Waiting',
    namesYou: true,
    namesAWorker: true,
    ...over,
});

describe('L-6: a refused worker link is said plainly', () => {
    it('in at once, but the attendance-list name was not joined: the card says so', async () => {
        mockAccept.mockResolvedValue({ farmId: 'farm-1', farmName: 'पाटील फार्म', status: 'Active', membershipId: 'm', workerLinked: false });
        render(<InvitationCard card={card()} />);
        fireEvent.click(screen.getByTestId('invitation-accept'));
        await waitFor(() => expect(screen.getByTestId('invitation-active')).toBeInTheDocument());
        expect(screen.getByTestId('invitation-worker-not-linked'))
            .toHaveTextContent('हजेरी यादीतलं तुमचं नाव या खात्याशी आत्ता जोडता आलं नाही. मालक ते नंतर पाहतील.');
    });

    it('a link that happened says nothing extra', async () => {
        mockAccept.mockResolvedValue({ farmId: 'farm-1', farmName: 'पाटील फार्म', status: 'Active', membershipId: 'm', workerLinked: true });
        render(<InvitationCard card={card()} />);
        fireEvent.click(screen.getByTestId('invitation-accept'));
        await waitFor(() => expect(screen.getByTestId('invitation-active')).toBeInTheDocument());
        expect(screen.queryByTestId('invitation-worker-not-linked')).toBeNull();
    });
});

describe('L-2: the invited person hears the right reason', () => {
    const refused = (status: number, error?: string) => ({ response: { status, data: error ? { error } : {} } });

    it('a phone number not yet proven is not "only the main owner can do this"', () => {
        expect(invitationRefusal(refused(403, 'join.phone_not_verified'), 'invitee')).toBe('phone_not_verified');
        expect(invitationRefusal(refused(403, 'forbidden'), 'owner')).toBe('forbidden');
    });

    it('a bad answer on the invited side is "code not found", not "the invitation was not made"', () => {
        expect(invitationRefusal(refused(400, 'invalid_command'), 'invitee')).toBe('unknown');
        expect(invitationRefusal(refused(400, 'invalid_command'), 'owner')).toBe('invalid');
    });

    it('the race answers have their own words', () => {
        expect(invitationRefusal(refused(409, 'invitation.try_again'), 'invitee')).toBe('try_again');
        expect(invitationRefusal(refused(409, 'invitation.number_busy'), 'owner')).toBe('number_busy');
    });

    it('every refusal has its words in both languages', () => {
        for (const copy of [INVITATION_COPY_FOR_TESTS.mr, INVITATION_COPY_FOR_TESTS.en]) {
            for (const key of ['phone_not_verified', 'try_again', 'number_busy'] as const) {
                expect(copy.refusal[key]).toBeTruthy();
            }
        }
    });
});

describe('M-2: an authority that does nothing on this grant', () => {
    it('is never sent: a कामगार keeps his own records, so money is left out', () => {
        const grant = withAuthorities(presetGrant('Worker'), [{ name: 'SeeMoney', expiresAtUtc: null }, { name: 'TakeAttendance', expiresAtUtc: null }]);
        expect(createBody(grant, {}).authorities.map(a => a.name)).toEqual(['TakeAttendance']);
    });

    it('is never sent: farm setup needs every plot', () => {
        const grant = withPlots(withAuthorities(presetGrant('Family'), [{ name: 'EditFarmSetup', expiresAtUtc: null }]), 'ChosenPlots', ['p1']);
        expect(createBody(grant, {}).authorities.map(a => a.name)).toEqual([]);
    });

    it('is never promised on a card, even if an older invitation stored it', () => {
        const lines = cardLines(
            { label: 'Worker', plotScope: 'OwnWork', plotNames: [], authorities: [{ name: 'SeeMoney', expiresAtUtc: null }] },
            INVITATION_COPY_FOR_TESTS.mr,
            'mr',
        );
        expect(lines.authorities).toEqual(['पैसे दिसत नाहीत']);
    });
});
