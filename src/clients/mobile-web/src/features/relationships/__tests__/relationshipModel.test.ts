/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1. The pure reading of /me/context behind the "तुम्ही इथे" card, the
 * farm switcher and the relationship cards: the role and plots line per role, the switcher's rows (Active relationships only, an
 * expiry only when near), and the cards' states. Marathi mode Marathi only, English mode English.
 *
 * Repair R3 lane S1 (V3-D, 27 Nov 2026): the role band ("तुम्ही: ‹नाव› · ‹भूमिका›") and the nameboard's small word are gone; the
 * colour card's line "‹भूमिका› · ‹प्लॉट›" takes their words, and now a single-farm owner sees it too (the design's change to MU §6
 * Scenario A).
 */
import { describe, expect, it } from 'vitest';
import type { MeContext, MeFarm } from '../../../core/session/MeContextService';
import {
    hereLineFor, isChosenPlotsSeat, labelKeyOf, nearestEnd, ownsNoFarm, relationshipCards, switcherRows,
} from '../relationshipModel';
import { relationshipCopy } from '../relationshipCopy';

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

describe('the "तुम्ही इथे" line (V3-D colour card)', () => {
    it('a single-farm primary owner gets it too: "मालक · सर्व प्लॉट"', () => {
        const ctx = me([farm({ farmId: 'a', role: 'PrimaryOwner', plotScope: 'AllPlots' })]);
        expect(hereLineFor(ctx, 'a', 'mr')).toBe('मालक · सर्व प्लॉट');
    });

    it('an owner who holds two farms is told which hat he wears on each', () => {
        const ctx = me([
            farm({ farmId: 'a', name: 'Arve Farm', role: 'PrimaryOwner', plotScope: 'AllPlots' }),
            farm({ farmId: 'b', name: 'Patil Farm', role: 'Mukadam', label: 'Mukadam', plotScope: 'AllPlots' }),
        ]);
        expect(hereLineFor(ctx, 'a', 'mr')).toBe('मालक · सर्व प्लॉट');
        expect(hereLineFor(ctx, 'b', 'mr')).toBe('मुकादम · सर्व प्लॉट');
    });

    it('per role: a मुकादम on chosen plots, a कामगार on his own work, a सहमालक, a कुटुंब', () => {
        const mukadam = me([farm({ farmId: 'a', role: 'Mukadam', label: 'Mukadam', plotScope: 'ChosenPlots', plotNames: ['प्लॉट 2', 'प्लॉट 4', 'प्लॉट 5'] })]);
        expect(hereLineFor(mukadam, 'a', 'mr')).toBe('मुकादम · 3 प्लॉट');
        const worker = me([farm({ farmId: 'a', role: 'Worker', plotScope: 'OwnWork' })]);
        expect(hereLineFor(worker, 'a', 'mr')).toBe('कामगार · स्वतःचं काम');
        const co = me([farm({ farmId: 'a', role: 'SecondaryOwner', label: 'CoOwner', plotScope: 'AllPlots' })]);
        expect(hereLineFor(co, 'a', 'mr')).toBe('सहमालक · सर्व प्लॉट');
        const family = me([farm({ farmId: 'a', role: 'SecondaryOwner', label: 'Family', plotScope: 'AllPlots' })]);
        expect(hereLineFor(family, 'a', 'mr')).toBe('कुटुंब · सर्व प्लॉट');
        // A seat made before MU-2 carries no label: its role is read, never a guessed label (P4).
        const old = me([farm({ farmId: 'a', role: 'SecondaryOwner', label: null, plotScope: 'AllPlots' })]);
        expect(labelKeyOf(old.farms[0]!)).toBe('CoOwner');
    });

    it('English mode is English only', () => {
        const ctx = me([farm({ farmId: 'a', role: 'Mukadam', label: 'Mukadam', plotScope: 'ChosenPlots', plotNames: ['P1'] })]);
        expect(hereLineFor(ctx, 'a', 'en')).toBe('Mukadam · 1 plot');
        expect(hereLineFor(ctx, 'a', 'en')).not.toMatch(DEVANAGARI);
    });

    it('a server that sent no plot scope reads every plot (older server), not a made-up count', () => {
        const ctx = me([farm({ farmId: 'a', role: 'SecondaryOwner', plotScope: undefined, plotNames: undefined })]);
        expect(hereLineFor(ctx, 'a', 'mr')).toBe('सहमालक · सर्व प्लॉट');
    });

    it('reads the OPEN farm only: never another seat\'s role, and nothing without the context', () => {
        const ctx = me([farm({ farmId: 'a', role: 'Worker', plotScope: 'OwnWork' })]);
        expect(hereLineFor(ctx, 'z', 'mr')).toBeNull();
        expect(hereLineFor(null, 'a', 'mr')).toBeNull();
        expect(hereLineFor(me([farm({ farmId: 'a', status: 'PendingApproval' })]), 'a', 'mr')).toBeNull();
    });
});

describe('the colour card\'s words', () => {
    it('Marathi: "तुम्ही इथे", "३ शेती" (Devanagari digits), "आता: ‹शेत›"; the switcher\'s pill is "सध्या इथे"', () => {
        const mr = relationshipCopy('mr');
        expect(mr.here.label).toBe('तुम्ही इथे');
        expect(mr.here.farmCount(3)).toBe('३ शेती');
        expect(mr.here.farmCount(2)).toBe('२ शेती');
        expect(mr.here.now('पाटील मळा')).toBe('आता: पाटील मळा');
        expect(mr.switcher.current).toBe('सध्या इथे');
    });

    it('English: "You are here", "3 farms", "Now: ‹farm›", "Current"; no Devanagari', () => {
        const en = relationshipCopy('en');
        expect(en.here.label).toBe('You are here');
        expect(en.here.farmCount(3)).toBe('3 farms');
        expect(en.here.now('Patil Farm')).toBe('Now: Patil Farm');
        expect(en.switcher.current).toBe('Current');
        expect([en.here.label, en.here.farmCount(2), en.here.now('X'), en.switcher.current].join(' ')).not.toMatch(DEVANAGARI);
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
