/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the team screen's reading of the server roster.
 * CONTENT checks: who is a request, who is listed, under which name, what line, which phone tail,
 * how a person came in, and which controls the caller may see (the server's own guards, mirrored
 * so no refused control is drawn — P5). Founder D-22 (26 Oct): only the PRIMARY owner decides; the
 * family / co-owner choice is not offered in step 2.
 */
import { describe, expect, it } from 'vitest';
import type { LabourPermission } from '../../data/labourPermissionsClient';
import {
    PRESETS, arrivalLine, doLine, nameFor, phoneLine, presetOf, rightsOver, roleWord, splitRoster,
} from '../teamModel';

const row = (over: Partial<LabourPermission>): LabourPermission => ({
    userId: 'u', role: 'Worker', status: 'Active', canManageLabourRecords: false, hasExplicitGrant: false,
    source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null, ...over,
});

describe('splitRoster', () => {
    it('puts waiting requests apart (oldest first), lists Active + paused people, and drops ended seats', () => {
        const split = splitRoster([
            row({ userId: 'late', status: 'PendingApproval', requestedAtUtc: '2026-10-26T10:00:00Z' }),
            row({ userId: 'early', status: 'PendingApproval', requestedAtUtc: '2026-10-25T10:00:00Z' }),
            row({ userId: 'w', role: 'Worker' }),
            row({ userId: 'paused', role: 'Mukadam', status: 'Suspended' }),
            row({ userId: 'gone', status: 'Revoked' }),
            row({ userId: 'left', status: 'Exited' }),
            row({ userId: 'reg', role: 'PrimaryOwner', isRegistrant: true }),
            row({ userId: 'co', role: 'SecondaryOwner' }),
        ]);
        expect(split.requests.map(r => r.userId)).toEqual(['early', 'late']);
        expect(split.people.map(r => r.userId)).toEqual(['reg', 'co', 'paused', 'w']);
    });

    it('an unclaimed invitation (PendingOtpClaim) is neither a request nor a person: the server cannot approve it (SEC-MU2-4)', () => {
        const split = splitRoster([
            row({ userId: 'asked', status: 'PendingApproval' }),
            row({ userId: 'unclaimed', status: 'PendingOtpClaim' }),
        ]);
        expect(split.requests.map(r => r.userId)).toEqual(['asked']);
        expect(split.people).toEqual([]);
    });

    it('no roster yet is no people (never an invented list)', () => {
        expect(splitRoster(null)).toEqual({ requests: [], people: [] });
    });
});

describe('nameFor', () => {
    it('server name first, then this phone\'s name for the SAME server id, else a dash — never invented', () => {
        expect(nameFor(row({ displayName: ' सुनील ' }))).toBe('सुनील');
        expect(nameFor(row({ userId: 'u9', displayName: null }), [{ id: 'u9', name: 'रमेश' } as never])).toBe('रमेश');
        expect(nameFor(row({ userId: 'u9', displayName: null }), [{ id: 'other', name: 'रमेश' } as never])).toBe('—');
    });
});

describe('phoneLine (M-7) — who is really asking', () => {
    it('shows the last four digits the server sent, and nothing when it sent none or something else', () => {
        expect(phoneLine(row({ phoneLast4: '4321' }))).toBe('मोबाईल …4321');
        expect(phoneLine(row({ phoneLast4: null }))).toBe('');
        expect(phoneLine(row({}))).toBe('');
        expect(phoneLine(row({ phoneLast4: '9876504321' }))).toBe('');
    });
});

describe('arrivalLine (M-8) — how a person came in', () => {
    it('tells a direct QR join apart from a request the owner approved', () => {
        expect(arrivalLine(row({ joinedVia: 'QrScan', approvedByOwner: false }))).toBe('QR ने थेट आले');
        expect(arrivalLine(row({ joinedVia: 'SelfJoin', approvedByOwner: true }))).toBe('कोड टाकून विचारलं · मालकाने मंजूर केलं');
        expect(arrivalLine(row({ joinedVia: 'QrScan', approvedByOwner: true }))).toBe('QR स्कॅन करून विचारलं · मालकाने मंजूर केलं');
    });

    it('says nothing it cannot know (an owner-added seat, an unknown way)', () => {
        expect(arrivalLine(row({ joinedVia: 'OwnerManualAdd' }))).toBe('');
        expect(arrivalLine(row({ joinedVia: 'PrimaryOwnerBootstrap', isRegistrant: true }))).toBe('');
        expect(arrivalLine(row({}))).toBe('');
    });
});

describe('doLine', () => {
    it('every Active person tells work and records a purchase; हजेरी · पक्कं only with the grant', () => {
        expect(doLine(row({ role: 'Worker', permissions: [] }))).toBe('काम सांगणे · खर्च नोंदवणे');
        expect(doLine(row({ role: 'Mukadam', canManageLabourRecords: true, permissions: [] })))
            .toBe('काम सांगणे · खर्च नोंदवणे · हजेरी · पक्कं करणे');
        expect(doLine(row({ role: 'PrimaryOwner', canManageLabourRecords: true, isRegistrant: true,
            permissions: ['SeeMoney', 'SeeWages', 'AddCost', 'PlanWork', 'Invite', 'AddTestRecord'] })))
            .toBe('काम सांगणे · खर्च नोंदवणे · हजेरी · पक्कं करणे · माणसं बोलावणे');
    });

    it('never claims seeing money or planning work (no phone is narrowed by them yet), and says nothing for a paused seat', () => {
        const line = doLine(row({ role: 'Mukadam', permissions: ['SeeMoney', 'SeeWages', 'PlanWork'] }));
        expect(line).toBe('काम सांगणे · खर्च नोंदवणे');
        expect(line).not.toContain('काम ठरवणे');
        expect(doLine(row({ status: 'Suspended', canManageLabourRecords: true }))).toBe('');
    });

    it('only the owner tier is told he may bring people (the farm QR is owner tier)', () => {
        expect(doLine(row({ role: 'Worker', permissions: ['Invite'] }))).toBe('काम सांगणे · खर्च नोंदवणे');
    });
});

describe('roleWord / presetOf / PRESETS — two choices in step 2 (D-22)', () => {
    it.each([
        ['PrimaryOwner', 'मालक', null],
        ['SecondaryOwner', 'सहमालक', null],
        ['Mukadam', 'मुकादम', 'crew'],
        ['Worker', 'कामगार', 'work'],
    ])('%s reads %s', (role, word, preset) => {
        expect(roleWord(role)).toBe(word);
        expect(presetOf(role)).toBe(preset);
    });

    it('offers exactly काम सांगणे and काम + हजेरी — no कुटुंब, no co-owner choice', () => {
        expect(PRESETS.map(p => p.label)).toEqual(['काम सांगणे', 'काम + हजेरी']);
        expect(JSON.stringify(PRESETS)).not.toMatch(/कुटुंब|सहमालक|मालकासारखं/);
    });
});

describe('rightsOver — the server guards, mirrored (M-1: the primary owner only)', () => {
    const owner = { userId: 'me', role: 'PrimaryOwner' };

    it('only the PRIMARY owner decides: a co-owner, a मुकादम and a worker decide nothing', () => {
        for (const role of ['SecondaryOwner', 'Mukadam', 'Worker']) {
            expect(rightsOver(row({ userId: 'w' }), { userId: 'me', role })).toEqual({ canDecide: false, canChangeRole: false });
        }
        expect(rightsOver(row({ userId: 'w' }), owner)).toEqual({ canDecide: true, canChangeRole: true });
    });

    it('nobody decides about themselves or about the registrant', () => {
        expect(rightsOver(row({ userId: 'me', role: 'PrimaryOwner' }), owner).canDecide).toBe(false);
        expect(rightsOver(row({ userId: 'reg', role: 'PrimaryOwner', isRegistrant: true }), owner).canDecide).toBe(false);
        expect(rightsOver(row({ userId: 'w' }), { userId: null, role: 'PrimaryOwner' }).canDecide).toBe(false);
    });

    it('the primary owner decides about an existing co-owner (a person, not a second authority)', () => {
        expect(rightsOver(row({ userId: 'co', role: 'SecondaryOwner' }), owner)).toEqual({ canDecide: true, canChangeRole: true });
    });

    it('a second primary owner may be paused or removed but keeps his role', () => {
        expect(rightsOver(row({ userId: 'p2', role: 'PrimaryOwner' }), owner)).toEqual({ canDecide: true, canChangeRole: false });
    });

    it('a primary owner the roster names as NOT the registrant decides nothing; an older server (no flag) reads by role (SEC-MU2-6)', () => {
        const none = { canDecide: false, canChangeRole: false };
        expect(rightsOver(row({ userId: 'w' }), { ...owner, isRegistrant: false })).toEqual(none);
        expect(rightsOver(row({ userId: 'w' }), { ...owner, isRegistrant: true })).toEqual({ canDecide: true, canChangeRole: true });
        expect(rightsOver(row({ userId: 'w' }), { ...owner, isRegistrant: undefined })).toEqual({ canDecide: true, canChangeRole: true });
    });
});
