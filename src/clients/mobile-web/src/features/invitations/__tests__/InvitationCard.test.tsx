// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2. The invited person's card: its words match the grant
 * the server sent; स्वीकारा and नको send the answer and the card shows what the server said; an ended invitation says
 * why in Marathi; Marathi mode is Marathi only and English mode English only. Only the network is stubbed.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ lang: null as 'mr' | 'en' | null }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => (h.lang ? { language: h.lang, setLanguage: () => undefined, t: (k: string) => k } : undefined),
}));
const mockAccept = vi.fn();
const mockDecline = vi.fn();
vi.mock('../personalInvitationClient', async (actual) => ({
    ...(await actual<typeof import('../personalInvitationClient')>()),
    acceptInvitation: (...a: unknown[]) => mockAccept(...a),
    declineInvitation: (...a: unknown[]) => mockDecline(...a),
}));

import { InvitationCard } from '../InvitationCard';
import { INVITATION_COPY_FOR_TESTS } from '../invitationCopy';
import type { InvitationCard as Card } from '../personalInvitationClient';

const DEVANAGARI = /[ऀ-ॿ]/;
// Marathi mode: Devanagari, digits, punctuation — and "QR", the design's own word. Nothing else in Latin letters.
const LATIN_OUTSIDE_QR = (text: string) => text.replace(/QR/g, '').match(/[A-Za-z]/);

const card = (over: Partial<Card> = {}): Card => ({
    invitationId: 'inv-1',
    farmName: 'पाटील फार्म',
    invitedByName: 'रामराव',
    label: 'Mukadam',
    name: 'रमेश',
    plotScope: 'ChosenPlots',
    plotNames: ['प्लॉट 1', 'प्लॉट 3'],
    authorities: [{ name: 'TakeAttendance', expiresAtUtc: null }],
    expiresAtUtc: '2026-11-13T06:00:00Z',
    status: 'Waiting',
    namesYou: true,
    namesAWorker: false,
    ...over,
});

beforeEach(() => { h.lang = null; mockAccept.mockReset(); mockDecline.mockReset(); });
afterEach(cleanup);

describe('the card says the grant', () => {
    it('"‹farm› ने तुम्हाला बोलावलं आहे · जबाबदारी · प्लॉट · हजेरी घेऊ शकतात · पैसे दिसत नाहीत"', () => {
        render(<InvitationCard card={card()} />);
        expect(screen.getByTestId('invitation-title')).toHaveTextContent('पाटील फार्म ने तुम्हाला बोलावलं आहे');
        expect(screen.getByTestId('invitation-responsibility')).toHaveTextContent('जबाबदारी: मुकादम');
        expect(screen.getByTestId('invitation-plots')).toHaveTextContent('प्लॉट: प्लॉट 1, प्लॉट 3');
        expect(screen.getAllByTestId('invitation-authority').map(l => l.textContent)).toEqual(['हजेरी घेऊ शकतात', 'पैसे दिसत नाहीत']);
        expect(screen.getByTestId('invitation-accept')).toHaveTextContent('स्वीकारा');
        expect(screen.getByTestId('invitation-decline')).toHaveTextContent('नको');
    });

    it('Marathi mode is Marathi only; English mode is English only', () => {
        const { unmount } = render(<InvitationCard card={card({ farmName: 'Patil Farm', invitedByName: 'Ramrao', name: null, plotNames: [] , plotScope: 'AllPlots' })} />);
        const marathi = (document.body.textContent ?? '').replace(/Patil Farm|Ramrao/g, '');
        expect(LATIN_OUTSIDE_QR(marathi)).toBeNull();
        unmount();

        h.lang = 'en';
        render(<InvitationCard card={card({ farmName: 'Patil Farm', invitedByName: 'Ramrao', plotScope: 'AllPlots', plotNames: [] })} />);
        expect(document.body.textContent).not.toMatch(DEVANAGARI);
        expect(screen.getByTestId('invitation-accept')).toHaveTextContent('Accept');
    });

    it('every word of the copy is in its own language', () => {
        const strings = (o: unknown): string[] => typeof o === 'string' ? [o]
            : typeof o === 'function' ? [(o as (...a: string[]) => string)('', '', '')]
                : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : [];
        for (const s of strings(INVITATION_COPY_FOR_TESTS.mr)) expect(LATIN_OUTSIDE_QR(s), s).toBeNull();
        for (const s of strings(INVITATION_COPY_FOR_TESTS.en)) expect(s, s).not.toMatch(DEVANAGARI);
    });
});

describe('स्वीकारा / नको', () => {
    it('स्वीकारा sends the card it was listed as, and shows Active when the server says so', async () => {
        mockAccept.mockResolvedValue({ farmId: 'f1', farmName: 'पाटील फार्म', status: 'Active', membershipId: 'm1', workerLinked: false });
        const onAnswered = vi.fn();
        render(<InvitationCard card={card()} onAnswered={onAnswered} />);
        fireEvent.click(screen.getByTestId('invitation-accept'));
        await waitFor(() => expect(screen.getByTestId('invitation-active')).toHaveTextContent('तुम्ही आता पाटील फार्म मध्ये आहात'));
        expect(mockAccept).toHaveBeenCalledWith({ invitationId: 'inv-1' });
        expect(onAnswered).toHaveBeenCalledWith(expect.objectContaining({ status: 'Active' }));
    });

    it('a card found by its code answers with that code, and a request waits for the owner', async () => {
        mockAccept.mockResolvedValue({ farmId: 'f1', farmName: 'x', status: 'PendingApproval', membershipId: 'm1', workerLinked: false });
        render(<InvitationCard card={card({ namesYou: false })} code="48217730" />);
        expect(screen.getByTestId('invitation-waits-note')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('invitation-accept'));
        await waitFor(() => expect(screen.getByTestId('invitation-waiting')).toHaveTextContent('मंजुरीची वाट'));
        expect(mockAccept).toHaveBeenCalledWith({ code: '48217730' });
    });

    it('नको declines it; nothing joins', async () => {
        mockDecline.mockResolvedValue(undefined);
        render(<InvitationCard card={card()} />);
        fireEvent.click(screen.getByTestId('invitation-decline'));
        await waitFor(() => expect(screen.getByTestId('invitation-declined')).toBeInTheDocument());
        expect(mockDecline).toHaveBeenCalledWith({ invitationId: 'inv-1' });
        expect(mockAccept).not.toHaveBeenCalled();
    });

    it('an ended invitation says why, in Marathi, with no buttons', () => {
        render(<InvitationCard card={card({ status: 'Expired' })} code="48217730" />);
        expect(screen.getByTestId('invitation-refused')).toHaveTextContent('मुदत संपली');
        expect(screen.queryByTestId('invitation-accept')).toBeNull();
    });

    it('a refusal from the server is said, never "done"', async () => {
        mockAccept.mockRejectedValue({ response: { status: 409, data: { error: 'invitation.used' } } });
        render(<InvitationCard card={card()} />);
        fireEvent.click(screen.getByTestId('invitation-accept'));
        await waitFor(() => expect(screen.getByTestId('invitation-refused')).toHaveTextContent('आधीच वापरलं'));
        expect(screen.queryByTestId('invitation-active')).toBeNull();
    });
});
