// spec: plr-d10-redesign-real-integration-2026-10-25 (lane GRP-1a) - groupsOfCrop and the natural number order it uses.
import { describe, expect, it } from 'vitest';

import { compareNaturally, groupNameOf, groupsOfCrop } from '../groupsOfCrop';

const plot = (id: string, name: string, groupName?: string | null) => ({ id, name, ...(groupName === undefined ? {} : { groupName }) });

describe('compareNaturally (plot names in number order)', () => {
    it('puts G2 before G10 where plain text order would not', () => {
        expect(['G10', 'G2', 'G1', 'G15'].sort(compareNaturally)).toEqual(['G1', 'G2', 'G10', 'G15']);
        expect(['G10', 'G2'].sort()).toEqual(['G10', 'G2']);
    });

    it('reads Devanagari digits as numbers too', () => {
        expect(['प्लॉट १०', 'प्लॉट २', 'प्लॉट १'].sort(compareNaturally)).toEqual(['प्लॉट १', 'प्लॉट २', 'प्लॉट १०']);
    });

    it('treats leading zeros and mixed digit scripts as the same number', () => {
        expect(compareNaturally('G02', 'G2')).toBe(0);
        expect(compareNaturally('G१०', 'G9')).toBeGreaterThan(0);
    });

    it('orders a bare number before text and a shorter name before its longer one', () => {
        expect(['G', '10', 'G1', '9'].sort(compareNaturally)).toEqual(['9', '10', 'G', 'G1']);
    });
});

describe('groupNameOf', () => {
    it('is the trimmed name, or null for missing, null, blank and non-text', () => {
        expect(groupNameOf({ groupName: '  वरचा भाग ' })).toBe('वरचा भाग');
        expect(groupNameOf({})).toBeNull();
        expect(groupNameOf({ groupName: null })).toBeNull();
        expect(groupNameOf({ groupName: '   ' })).toBeNull();
        expect(groupNameOf({ groupName: 5 as unknown as string })).toBeNull();
    });
});

describe('groupsOfCrop', () => {
    it('gives nothing for no plots', () => {
        expect(groupsOfCrop([])).toEqual([]);
    });

    it('gives nothing when no plot has a group', () => {
        expect(groupsOfCrop([plot('a', 'G1'), plot('b', 'G2', null), plot('c', 'G3', '  ')])).toEqual([]);
    });

    it('puts plots with the same trimmed name in one group, in number order inside it (G2 before G10)', () => {
        const groups = groupsOfCrop([
            plot('p10', 'G10', 'विहिरीजवळचे'),
            plot('p2', 'G2', ' विहिरीजवळचे '),
            plot('p1', 'G1', 'विहिरीजवळचे'),
        ]);
        expect(groups).toEqual([{ name: 'विहिरीजवळचे', plotIds: ['p1', 'p2', 'p10'] }]);
    });

    it('orders the groups by their first plot in number order, whatever order the plots arrive in', () => {
        const groups = groupsOfCrop([
            plot('p12', 'G12', 'खालचा भाग'),
            plot('p3', 'G3', 'वरचा भाग'),
            plot('p11', 'G11', 'वरचा भाग'),
            plot('p5', 'G5', 'खालचा भाग'),
        ]);
        expect(groups.map(g => g.name)).toEqual(['वरचा भाग', 'खालचा भाग']);
        expect(groups).toEqual([
            { name: 'वरचा भाग', plotIds: ['p3', 'p11'] },
            { name: 'खालचा भाग', plotIds: ['p5', 'p12'] },
        ]);
    });

    it('leaves plots without a group out of every group', () => {
        const groups = groupsOfCrop([plot('a', 'G1'), plot('b', 'G2', 'X'), plot('c', 'G3', null), plot('d', 'G4', 'X')]);
        expect(groups).toEqual([{ name: 'X', plotIds: ['b', 'd'] }]);
    });

    it('keeps names that differ in anything but surrounding spaces as different groups', () => {
        const groups = groupsOfCrop([plot('a', 'G1', 'वर'), plot('b', 'G2', 'वर ए'), plot('c', 'G3', 'वर')]);
        expect(groups).toEqual([{ name: 'वर', plotIds: ['a', 'c'] }, { name: 'वर ए', plotIds: ['b'] }]);
    });

    it('does not change the plots it is given', () => {
        const input = [plot('b', 'G2', 'X'), plot('a', 'G1', 'X')];
        const copy = structuredClone(input);
        groupsOfCrop(input);
        expect(input).toEqual(copy);
    });

    it('is stable for two plots with the same name (by id)', () => {
        const groups = groupsOfCrop([plot('b', 'G1', 'X'), plot('a', 'G1', 'X')]);
        expect(groups).toEqual([{ name: 'X', plotIds: ['a', 'b'] }]);
    });
});
