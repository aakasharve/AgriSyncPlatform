/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2. The phone's pure invitation rules: the D-26 starting
 * sets, the three questions as edits of ONE grant, the body sent (exactly the grant), the card's words (from the grant),
 * and the eight-digit code as people type, paste or scan it.
 */
import { describe, expect, it } from 'vitest';
import { INVITATION_COPY_FOR_TESTS } from '../invitationCopy';
import {
    cardLines,
    createBody,
    displayInvitationCode,
    normalizeInvitationCode,
    notInForce,
    presetGrant,
    readMobile,
    withAuthorities,
    withLabel,
    withMoney,
    withPlots,
} from '../invitationModel';

const names = (g: { authorities: { name: string }[] }) => g.authorities.map(a => a.name);

describe('the starting sets (D-26) — a label grants nothing, it only pre-fills', () => {
    it('सहमालक: setup, attendance, confirm, money · कुटुंब: attendance and confirm · कामगार: nothing, his own work', () => {
        expect(names(presetGrant('CoOwner'))).toEqual(['EditFarmSetup', 'TakeAttendance', 'ConfirmRecords', 'SeeMoney']);
        expect(names(presetGrant('Family'))).toEqual(['TakeAttendance', 'ConfirmRecords']);
        expect(names(presetGrant('Mukadam'))).toEqual(['TakeAttendance']);
        expect(presetGrant('Worker')).toEqual({ label: 'Worker', plotScope: 'OwnWork', plotIds: [], authorities: [] });
        expect(presetGrant('Family').authorities.every(a => a.expiresAtUtc === null)).toBe(true);
    });

    it('a new label starts from its own set; the same label keeps the owner\'s edits', () => {
        const edited = withMoney(presetGrant('Family'), true);
        expect(withLabel(edited, 'Family')).toBe(edited);
        expect(names(withLabel(edited, 'Mukadam'))).toEqual(['TakeAttendance']);
    });
});

describe('the three questions edit one grant', () => {
    it('money: yes adds see money; no takes it with wages and review money', () => {
        const withAll = withAuthorities(presetGrant('Family'), [
            { name: 'TakeAttendance', expiresAtUtc: null },
            { name: 'SeeWages', expiresAtUtc: null },
            { name: 'ReviewMoney', expiresAtUtc: null },
        ]);
        expect(names(withAll)).toEqual(['TakeAttendance', 'SeeWages', 'ReviewMoney', 'SeeMoney']);
        expect(names(withMoney(withAll, false))).toEqual(['TakeAttendance']);
        expect(names(withMoney(presetGrant('Mukadam'), true))).toEqual(['TakeAttendance', 'SeeMoney']);
    });

    it('plots: chosen plots carry ids, every other scope none; setup and money say when they do nothing', () => {
        const chosen = withPlots(presetGrant('Mukadam'), 'ChosenPlots', ['p1', 'p3']);
        expect(chosen.plotIds).toEqual(['p1', 'p3']);
        expect(withPlots(chosen, 'AllPlots', ['p1']).plotIds).toEqual([]);
        expect(notInForce(chosen)).toEqual(['EditFarmSetup']);
        expect(notInForce(presetGrant('Worker'))).toEqual(['EditFarmSetup', 'SeeMoney', 'SeeWages']);
    });

    // AssignWork is the authority the server does not enforce yet (it waits for L8c); PlanWork became enforced with lane
    // L8b-1 (D-73), so it is no longer the unenforced example. 'Invite' stays the unknown one.
    it('an unenforced or unknown authority is never kept (P5)', () => {
        expect(names(withAuthorities(presetGrant('Worker'), [{ name: 'AssignWork', expiresAtUtc: null }, { name: 'Invite', expiresAtUtc: null }]))).toEqual([]);
    });
});

describe('the body is exactly the grant shown', () => {
    it('label, plots, every authority with its end, and the optional person', () => {
        const grant = withPlots(withMoney(presetGrant('Family'), true), 'ChosenPlots', ['p1']);
        expect(createBody(grant, { name: ' रमेश ', mobile: '6000012345', fieldOperatorId: 'w1' })).toEqual({
            label: 'Family',
            name: 'रमेश',
            invitedPhone: '6000012345',
            fieldOperatorId: 'w1',
            plotScope: 'ChosenPlots',
            plotIds: ['p1'],
            authorities: [
                { name: 'TakeAttendance', expiresAtUtc: null },
                { name: 'ConfirmRecords', expiresAtUtc: null },
                { name: 'SeeMoney', expiresAtUtc: null },
            ],
        });
        expect(createBody(presetGrant('Worker'), { name: '', mobile: null })).toEqual({ label: 'Worker', plotScope: 'OwnWork', authorities: [] });
    });

    it('a mobile is ten digits (a +91, 0 or Marathi digits are read), blank is allowed, anything else is wrong', () => {
        expect(readMobile('+91 60000 12345')).toEqual({ ok: true, digits: '6000012345' });
        expect(readMobile('०६००००१२३४५')).toEqual({ ok: true, digits: '6000012345' });
        expect(readMobile('')).toEqual({ ok: true, digits: null });
        expect(readMobile('12345')).toEqual({ ok: false, digits: null });
    });
});

describe("the card's words come from the grant the server sent", () => {
    it('Marathi: the responsibility, the plot names, each authority, and no money', () => {
        const lines = cardLines(
            { label: 'Mukadam', plotScope: 'ChosenPlots', plotNames: ['प्लॉट 1', 'प्लॉट 3'], authorities: [{ name: 'TakeAttendance', expiresAtUtc: null }] },
            INVITATION_COPY_FOR_TESTS.mr, 'mr');
        expect(lines).toEqual({
            responsibility: 'जबाबदारी: मुकादम',
            plots: 'प्लॉट: प्लॉट 1, प्लॉट 3',
            authorities: ['हजेरी घेऊ शकतात', 'पैसे दिसत नाहीत'],
        });
    });

    it('an end is said; money given is said; English only in English', () => {
        const lines = cardLines(
            { label: 'Family', plotScope: 'AllPlots', plotNames: [], authorities: [
                { name: 'SeeMoney', expiresAtUtc: null },
                { name: 'ConfirmRecords', expiresAtUtc: '2026-11-20T12:00:00Z' },
            ] },
            INVITATION_COPY_FOR_TESTS.en, 'en');
        expect(lines.responsibility).toBe('Responsibility: Family');
        expect(lines.plots).toBe('Plots: All plots');
        expect(lines.authorities[0]).toMatch(/^Can confirm records \(until .+\)$/);
        expect(lines.authorities[1]).toBe('Sees money');
    });
});

describe('the eight-digit code', () => {
    it.each([
        ['48217730', '48217730'],
        [' 4821-7730 ', '48217730'],
        ['४८२१ ७७३०', '48217730'],
        ['https://shramsafal.in/i/4821-7730', '48217730'],
        ['K7M2QP', null],
        ['482177', null],
        ['', null],
    ])('%s → %s', (typed, expected) => {
        expect(normalizeInvitationCode(typed)).toBe(expected);
    });

    it('is shown in two halves', () => {
        expect(displayInvitationCode('48217730')).toBe('4821-7730');
    });
});
