// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1, the carried small items: MU-2 review N-3 (review money on a
 * worker's invitation), N-4 (an erasure's word), N-6 (the request card's own line - proved in attentionOwnerCards), N-7 (the
 * claimed-from-invitation words), the switches' payout help line, and the service-proof door's Marathi / English twins.
 * Marathi mode Marathi only; English mode English only.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ lang: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: h.lang, setLanguage: () => undefined, t: (k: string) => k }),
    useLanguage: () => ({ language: h.lang, setLanguage: () => undefined, t: (k: string) => k }),
}));
const listInvitations = vi.fn();
vi.mock('../personalInvitationClient', async (importActual) => ({
    ...(await importActual<typeof import('../personalInvitationClient')>()),
    listInvitations: (...a: unknown[]) => listInvitations(...a),
}));

import { SentInvitations } from '../SentInvitations';
import { AuthoritySwitches } from '../../profile/team/AuthoritySwitches';
import { invitationCopy } from '../invitationCopy';
import { createBody, notInForce, withAuthorities, withMoney } from '../invitationModel';
import { invitationRefusal } from '../personalInvitationClient';
import { SERVICE_PROOF_WORDS } from '../../../i18n/serviceProofTranslations';

const DEVANAGARI = /[ऀ-ॿ]/;
beforeEach(() => { h.lang = 'mr'; listInvitations.mockReset(); });
afterEach(cleanup);

describe('N-3: review money on a worker\'s invitation', () => {
    const worker = { label: 'Worker' as const, plotScope: 'OwnWork' as const, plotIds: [] as string[], authorities: [] };

    it('is not in force wherever money is not, so the phone never sends it (the server said "needs see money" with no reason)', () => {
        expect(notInForce(worker)).toEqual(expect.arrayContaining(['SeeMoney', 'SeeWages', 'ReviewMoney']));
        // The owner turns on "पैशांच्या नोंदी तपासू शकतात": the switches add SeeMoney as well - both are left out of the body.
        const grant = withAuthorities(worker, [{ name: 'ReviewMoney', expiresAtUtc: null }]);
        const body = createBody(grant, {});
        expect(body.authorities.map(a => a.name)).not.toContain('ReviewMoney');
        expect(body.authorities.map(a => a.name)).not.toContain('SeeMoney');
        // A सहमालक on every plot keeps both.
        const co = withAuthorities({ label: 'CoOwner', plotScope: 'AllPlots', plotIds: [], authorities: [] }, [{ name: 'ReviewMoney', expiresAtUtc: null }]);
        expect(createBody(co, {}).authorities.map(a => a.name).sort()).toEqual(['ReviewMoney', 'SeeMoney']);
        expect(withMoney(co, false).authorities.map(a => a.name)).not.toContain('ReviewMoney');
    });

    it('the server\'s own refusal is said in plain words, in both languages', () => {
        const error = { response: { status: 400, data: { error: 'invitation.authority_does_nothing' } } };
        expect(invitationRefusal(error)).toBe('authority_idle');
        expect(invitationCopy('mr').refusal.authority_idle).toMatch(DEVANAGARI);
        expect(invitationCopy('en').refusal.authority_idle).not.toMatch(DEVANAGARI);
        // The generic line is no longer what a worker invitation with money gets.
        expect(invitationCopy('mr').refusal.authority_idle).not.toBe(invitationCopy('mr').refusal.invalid);
    });
});

describe('N-7: a request that came from an invitation', () => {
    it('is worded for what it is, not as "this request has already changed"', () => {
        const error = { response: { status: 409, data: { error: 'membership.claimed_from_invitation' } } };
        expect(invitationRefusal(error)).toBe('from_invitation');
        expect(invitationCopy('mr').refusal.from_invitation).toContain('आमंत्रणातून');
        expect(invitationCopy('mr').refusal.from_invitation).not.toBe(invitationCopy('mr').refusal.changed);
        expect(invitationCopy('en').refusal.from_invitation).not.toMatch(DEVANAGARI);
    });
});

describe('N-4: an invitation ended by an erasure', () => {
    const base = {
        id: 'i1', farmId: 'f', code: '48217730', link: 'x', label: 'Worker', name: null, invitedPhoneLast4: null, fieldOperatorId: null,
        plotScope: 'OwnWork', plotIds: [], plotNames: [], authorities: [], createdAtUtc: '2026-11-01T00:00:00Z', expiresAtUtc: '2026-11-08T00:00:00Z',
        claimedByUserId: null, claimedAtUtc: null, waitsForOwner: false, workerLinked: false,
    };

    it('says the person\'s data was erased; one the owner took back still says so', async () => {
        listInvitations.mockResolvedValue([
            { ...base, id: 'erased', status: 'Withdrawn', personErased: true },
            { ...base, id: 'taken', status: 'Withdrawn', personErased: false },
        ]);
        render(<SentInvitations farmId="f" onShowAgain={vi.fn()} />);
        const erased = await screen.findByTestId('sent-invitation-erased');
        expect(erased).toHaveTextContent('व्यक्तीची माहिती मिटवली, आमंत्रण बंद झालं');
        expect(erased).not.toHaveTextContent('परत घेतलं');
        expect(screen.getByTestId('sent-invitation-taken')).toHaveTextContent('परत घेतलं');
    });

    it('English mode has the English twin and no Marathi', async () => {
        h.lang = 'en';
        listInvitations.mockResolvedValue([{ ...base, id: 'erased', status: 'Withdrawn', personErased: true }]);
        render(<SentInvitations farmId="f" onShowAgain={vi.fn()} />);
        const erased = await screen.findByTestId('sent-invitation-erased');
        expect(erased).toHaveTextContent("The person's data was erased; the invitation ended");
    });
});

describe('the owner\'s switches: a seat that checks money entries but sees no wages cannot settle a payout', () => {
    const access = (names: string[]) => ({ authorities: names.map(name => ({ name, expiresAtUtc: null })), saving: false, onChange: vi.fn() });

    it('says so once, only when review money is on and see wages is off', () => {
        render(<AuthoritySwitches memberId="m1" access={access(['SeeMoney', 'ReviewMoney'])} />);
        expect(screen.getByTestId('authority-payout-note-m1')).toHaveTextContent('मजुरीचे पैसे देणं पूर्ण करता येणार नाही');
        cleanup();
        render(<AuthoritySwitches memberId="m1" access={access(['SeeMoney', 'SeeWages', 'ReviewMoney'])} />);
        expect(screen.queryByTestId('authority-payout-note-m1')).toBeNull();
        cleanup();
        render(<AuthoritySwitches memberId="m1" access={access(['TakeAttendance'])} />);
        expect(screen.queryByTestId('authority-payout-note-m1')).toBeNull();
    });

    it('has an English twin with no Marathi', () => {
        h.lang = 'en';
        render(<AuthoritySwitches memberId="m1" access={access(['SeeMoney', 'ReviewMoney'])} />);
        const note = screen.getByTestId('authority-payout-note-m1');
        expect(note).toHaveTextContent('cannot complete a wage payout');
        expect(note.textContent).not.toMatch(DEVANAGARI);
    });

    // D-70 option 2 (register F124): the owner is told, on the switch, that a person on chosen plots never sees day wages.
    it('says that day wages are not shown only when see wages is on and the person covers chosen plots', () => {
        const on = (plotsChosen?: boolean) => ({ ...access(['SeeMoney', 'SeeWages']), ...(plotsChosen === undefined ? {} : { plotsChosen }) });
        render(<AuthoritySwitches memberId="m1" access={on(true)} />);
        expect(screen.getByTestId('authority-day-wages-note-m1')).toHaveTextContent('दिवसाच्या हिशोबाची मजुरी');
        cleanup();
        render(<AuthoritySwitches memberId="m1" access={on(false)} />);
        expect(screen.queryByTestId('authority-day-wages-note-m1')).toBeNull();
        cleanup();
        render(<AuthoritySwitches memberId="m1" access={on()} />);
        expect(screen.queryByTestId('authority-day-wages-note-m1')).toBeNull();
        cleanup();
        render(<AuthoritySwitches memberId="m1" access={{ ...access(['TakeAttendance']), plotsChosen: true }} />);
        expect(screen.queryByTestId('authority-day-wages-note-m1')).toBeNull();
    });

    it('has an English twin with no Marathi', () => {
        h.lang = 'en';
        render(<AuthoritySwitches memberId="m1" access={{ ...access(['SeeMoney', 'SeeWages']), plotsChosen: true }} />);
        const note = screen.getByTestId('authority-day-wages-note-m1');
        expect(note).toHaveTextContent('day wages are not shown to him');
        expect(note.textContent).not.toMatch(DEVANAGARI);
    });
});

describe('F99 review: the service-proof door\'s twins', () => {
    it('the title, the door\'s line and the refusal each have a Marathi and an English version, one language each', () => {
        for (const key of ['title', 'doorLine', 'refused', 'notForThisSeat'] as const) {
            expect(SERVICE_PROOF_WORDS.mr[key]).toMatch(DEVANAGARI);
            expect(SERVICE_PROOF_WORDS.en[key]).not.toMatch(DEVANAGARI);
        }
    });
});
