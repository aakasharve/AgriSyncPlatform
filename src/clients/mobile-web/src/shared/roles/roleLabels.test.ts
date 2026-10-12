import { describe, it, expect } from 'vitest';
import { getOperatorRoleLabel, getRoleLabel, ROLE_LABELS } from './roleLabels';

/*
 * Founder decision 2026-10-12 (Marathi messages approved with corrections):
 * owner, co-owner, Mukadam and worker each carry their own accurate label,
 * the same on every surface. The owner is never a "worker".
 */
describe('role labels - one accurate Marathi word per role', () => {
    it('maps the four membership roles to मालक / सहमालक / मुकादम / कामगार', () => {
        expect(ROLE_LABELS.PrimaryOwner.mr).toBe('मालक');
        expect(ROLE_LABELS.SecondaryOwner.mr).toBe('सहमालक');
        expect(ROLE_LABELS.Mukadam.mr).toBe('मुकादम');
        expect(ROLE_LABELS.Worker.mr).toBe('कामगार');
    });

    it('resolves BOTH spellings in circulation (server PascalCase, local SCREAMING_SNAKE, any case)', () => {
        const cases: Array<[string, string]> = [
            ['PrimaryOwner', 'मालक'], ['PRIMARY_OWNER', 'मालक'],
            ['SecondaryOwner', 'सहमालक'], ['SECONDARY_OWNER', 'सहमालक'],
            ['Mukadam', 'मुकादम'], ['MUKADAM', 'मुकादम'],
            ['Worker', 'कामगार'], ['WORKER', 'कामगार'], ['worker', 'कामगार'],
        ];
        for (const [code, mr] of cases) expect(getOperatorRoleLabel(code).mr).toBe(mr);
    });

    it('the owner and co-owner are never labelled as workers', () => {
        for (const code of ['PrimaryOwner', 'PRIMARY_OWNER', 'SecondaryOwner', 'SECONDARY_OWNER', 'MUKADAM']) {
            const l = getOperatorRoleLabel(code);
            expect(l.mr).not.toBe('कामगार');
            expect(l.mr).not.toContain('कामाला येणारे');
        }
    });

    it('an unknown or missing role falls back to the neutral "सदस्य", never to worker', () => {
        expect(getOperatorRoleLabel('SOMETHING_NEW').mr).toBe('सदस्य');
        expect(getOperatorRoleLabel(undefined).mr).toBe('सदस्य');
        expect(getRoleLabel(null).mr).toBe('सदस्य');
    });

    it('the retired labels are gone from the registry', () => {
        const all = Object.values(ROLE_LABELS).map((l) => `${l.mr}|${l.short}|${l.display}`).join('\n');
        expect(all).not.toContain('कामाला येणारे');
        expect(all).not.toContain('जबाबदार ');
        expect(all).not.toContain('भागीदार');
    });
});
