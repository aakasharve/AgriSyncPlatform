import { describe, expect, it } from 'vitest';
import { capabilitiesForRole, mapOperatorRole } from '../operatorRole';

/* The server returns the literal "WORKER" as a placeholder when row-level
   security hides another member's membership, so a client-side WORKER from
   sync is not a known role. It must not be presented as one. */
describe('mapOperatorRole', () => {
    it.each([
        ['PrimaryOwner', 'PRIMARY_OWNER'],
        ['SECONDARY_OWNER', 'SECONDARY_OWNER'],
        ['Mukadam', 'MUKADAM'],
    ])('%s is a known role', (raw, mapped) => {
        expect(mapOperatorRole(raw)).toBe(mapped);
    });

    it.each(['WORKER', 'Worker', '', undefined, 'Agronomist'])('%s is not claimed as a known role', (raw) => {
        expect(mapOperatorRole(raw)).toBe('UNKNOWN');
    });

    it('unknown role keeps the same capabilities as before', () => {
        expect(capabilitiesForRole('UNKNOWN')).toEqual(capabilitiesForRole('WORKER'));
    });
});
