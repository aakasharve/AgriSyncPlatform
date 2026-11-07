/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1. The pure reading of /me/context behind the role band, the farm
 * switcher and the relationship cards: the band and plots line per role (a single-farm owner gets none), the switcher's rows
 * (Active relationships only, an expiry only when near), and the cards' states. Marathi mode Marathi only, English mode English.
 */
import { describe, expect, it } from 'vitest';
import type { MeContext, MeFarm } from '../../../core/session/MeContextService';
import {
    boardRelationWord, isChosenPlotsSeat, labelKeyOf, nearestEnd, ownsNoFarm, relationshipCards, roleBandFor, switcherRows,
} from '../relationshipModel';

const NOW = new Date('2026-11-07T06:00:00Z');
const DEVANAGARI = /[ऀ-ॿ]/;

const farm = (over: Partial<MeFarm> & { farmId: string }): MeFarm => ({
    name: 'पाटील फार्म',
    farmCode: 'K7M2QP',
    ownerAccountId: 'acc',
    role: 'Worker',
    status: 'Active',
    joinedVia: 'QrScan',
    plan: 'Free',
    planValidUntilUtc: null,
    capabilities: { canInvite: false, canVerify: false, canAddCost: true, canSeeBilling: false },
    permissions: [],
    authorities: [],
    plotScope: 'OwnWork',
    plotNames: [],
    ...over,
});

const me = (farms: MeFarm[], over: Partial<MeContext> = {}): MeContext => ({
    me: { userId: 'u', displayName: 'रामराव', phoneMasked: '******1234', phoneVerifiedAtUtc: null, preferredLanguage: 'mr', authMode: 'Otp' },
    farms,
    share: { referralCode: null, referralsTotal: 0, referralsQualified: 0, benefitsEarned: 0 },
    alerts: [],
    serverTimeUtc: NOW.toISOString(),
    ...over,
});

describe('the role band', () => {
    it('a single-farm primary owner gets none: his screens stay as today (Scenario A)', () => {
        const ctx = me([farm({ farmId: 'a', role: 'PrimaryOwner', plotScope: 'AllPlots' })]);
        expect(roleBandFor(ctx, 'a', 'mr')).toBeNull();
        expect(boardRelationWord(ctx, 'a', 'mr')).toBeNull();
    });

    it('an owner who holds two farms is told which hat he wears on each', () => {
        const ctx = me([
            farm({ farmId: 'a', name: 'Arve Farm', role: 'PrimaryOwner', plotScope: 'AllPlots' }),
            farm({ farmId: 'b', name: 'Patil Farm', role: 'Mukadam', label: 'Mukadam', plotScope: 'AllPlots' }),
        ]);
        expect(roleBandFor(ctx, 'a', 'mr')).toEqual({ line: 'तुम्ही: रामराव · मालक', plots: 'सर्व प्लॉट' });
        expect(roleBandFor(ctx, 'b', 'mr')).toEqual({ line: 'तुम्ही: रामराव · मुकादम', plots: 'सर्व प्लॉट' });
    });

    it('per role: a मुकादम on chosen plots, a कामगार on his own work, a सहमालक, a कुटुंब', () => {
        const mukadam = me([farm({ farmId: 'a', role: 'Mukadam', label: 'Mukadam', plotScope: 'ChosenPlots', plotNames: ['प्लॉट 2', 'प्लॉट 4', 'प्लॉट 5'] })]);
        expect(roleBandFor(mukadam, 'a', 'mr')).toEqual({ line: 'तुम्ही: रामराव · मुकादम', plots: '3 प्लॉट' });
        const worker = me([farm({ farmId: 'a', role: 'Worker', plotScope: 'OwnWork' })]);
        expect(roleBandFor(worker, 'a', 'mr')).toEqual({ line: 'तुम्ही: रामराव · कामगार', plots: 'स्वतःचं काम' });
        const co = me([farm({ farmId: 'a', role: 'SecondaryOwner', label: 'CoOwner', plotScope: 'AllPlots' })]);
        expect(roleBandFor(co, 'a', 'mr')?.line).toBe('तुम्ही: रामराव · सहमालक');
        const family = me([farm({ farmId: 'a', role: 'SecondaryOwner', label: 'Family', plotScope: 'AllPlots' })]);
        expect(roleBandFor(family, 'a', 'mr')?.line).toBe('तुम्ही: रामराव · कुटुंब');
        // A seat made before MU-2 carries no label: its role is read, never a guessed label (P4).
        const old = me([farm({ farmId: 'a', role: 'SecondaryOwner', label: null, plotScope: 'AllPlots' })]);
        expect(labelKeyOf(old.farms[0]!)).toBe('CoOwner');
    });

    it('English mode is English only', () => {
        const ctx = me([farm({ farmId: 'a', role: 'Mukadam', label: 'Mukadam', plotScope: 'ChosenPlots', plotNames: ['P1'] })]);
        const band = roleBandFor(ctx, 'a', 'en')!;
        expect(band.line).toBe('You: रामराव · Mukadam');
        expect(band.plots).toBe('1 plot');
        expect(boardRelationWord(ctx, 'a', 'en')).toBe('Mukadam');
        expect(band.plots).not.toMatch(DEVANAGARI);
    });

    it('a server that sent no plot scope reads every plot (older server), not a made-up count', () => {
        const ctx = me([farm({ farmId: 'a', role: 'SecondaryOwner', plotScope: undefined, plotNames: undefined })]);
        expect(roleBandFor(ctx, 'a', 'mr')?.plots).toBe('सर्व प्लॉट');
    });
});

describe('the switcher rows', () => {
    it('one row per ACTIVE relationship; a waiting request, a paused seat and an invitation are never rows', () => {
        const ctx = me(
            [
                farm({ farmId: 'a', name: 'Arve Farm', role: 'PrimaryOwner', plotScope: 'AllPlots' }),
                farm({ farmId: 'b', name: 'Patil Farm', role: 'Mukadam', label: 'Mukadam', plotScope: 'ChosenPlots', plotNames: ['प्लॉट 1', 'प्लॉट 2'] }),
                farm({ farmId: 'w', name: 'Waiting Farm', status: 'PendingApproval' }),
                farm({ farmId: 'p', name: 'Paused Farm', status: 'Suspended', statusReason: 'हंगाम संपला' }),
            ],
            { invitations: [{ invitationId: 'i', farmName: 'Invited Farm', invitedByName: null, label: 'Worker', name: null, plotScope: 'OwnWork', plotNames: [], authorities: [], expiresAtUtc: '2026-11-12T00:00:00Z', namesAWorker: false }] },
        );
        const rows = switcherRows(ctx, 'b', 'mr', NOW);
        expect(rows.map(r => r.name)).toEqual(['Arve Farm', 'Patil Farm']);
        expect(rows.map(r => r.current)).toEqual([false, true]);
        expect(rows[1]).toMatchObject({ word: 'मुकादम', plots: '2 प्लॉट', until: null });
        expect(rows[0]).toMatchObject({ word: 'मालक', plots: 'सर्व प्लॉट' });
    });

    it('shows an expiry only when it is near, and in his language', () => {
        const near = '2026-11-10T00:00:00Z';
        const far = '2027-03-01T00:00:00Z';
        const past = '2026-11-01T00:00:00Z';
        const ctx = (end: string | null) => me([
            farm({ farmId: 'a', role: 'Mukadam', plotScope: 'AllPlots', authorities: [{ name: 'TakeAttendance', expiresAtUtc: end }] }),
        ]);
        expect(switcherRows(ctx(near), 'a', 'mr', NOW)[0]!.until).toMatch(/पर्यंत$/);
        expect(switcherRows(ctx(near), 'a', 'en', NOW)[0]!.until).toMatch(/^until /);
        expect(switcherRows(ctx(far), 'a', 'mr', NOW)[0]!.until).toBeNull();
        expect(switcherRows(ctx(past), 'a', 'mr', NOW)[0]!.until).toBeNull();
        expect(switcherRows(ctx(null), 'a', 'mr', NOW)[0]!.until).toBeNull();
        expect(nearestEnd([{ name: 'A', expiresAtUtc: far }, { name: 'B', expiresAtUtc: near }], NOW)).toBe(new Date(near).toISOString());
    });

    it('a person with no farm of his own among his seats is asked about it; an owner is not', () => {
        expect(ownsNoFarm(me([farm({ farmId: 'a', role: 'Worker' })]))).toBe(true);
        expect(ownsNoFarm(me([farm({ farmId: 'a', role: 'Worker' }), farm({ farmId: 'b', role: 'PrimaryOwner' })]))).toBe(false);
        expect(ownsNoFarm(me([]))).toBe(false);
    });
});

describe('the relationship cards', () => {
    it('one card per relationship with its state; paused carries its reason, waiting none', () => {
        const ctx = me([
            farm({ farmId: 'a', name: 'Arve Farm', role: 'PrimaryOwner', plotScope: 'AllPlots' }),
            farm({ farmId: 'w', name: 'Waiting Farm', status: 'PendingApproval' }),
            farm({ farmId: 'p', name: 'Paused Farm', status: 'Suspended', statusReason: 'हंगाम संपला' }),
        ]);
        const cards = relationshipCards(ctx, 'mr', NOW);
        expect(cards.map(c => [c.farmId, c.state, c.reason])).toEqual([
            ['a', 'active', null],
            ['w', 'waiting', null],
            ['p', 'paused', 'हंगाम संपला'],
        ]);
    });

    it('a chosen-plots seat is the one whose money totals say "तुमच्या प्लॉटचे"', () => {
        expect(isChosenPlotsSeat({ role: 'Mukadam', plotScope: 'ChosenPlots' })).toBe(true);
        expect(isChosenPlotsSeat({ role: 'PrimaryOwner', plotScope: 'ChosenPlots' })).toBe(false);
        expect(isChosenPlotsSeat({ role: 'SecondaryOwner', plotScope: 'AllPlots' })).toBe(false);
        expect(isChosenPlotsSeat(null)).toBe(false);
    });
});
