/**
 * Test helper (not a test): a stand-in for `../identityApi` so a page test never reaches a network, with the person's own card as the server would
 * answer it. Use inside a `vi.mock` factory:
 *
 *   vi.mock('../../identity/identityApi', async () => (await import('../../identity/__tests__/identityApiStub')).identityApiStub({ complete: true }));
 */
import type { IdentityCallResult, MyIdentity } from '../identityApi';

export function stubCard(over: Partial<MyIdentity> = {}): MyIdentity {
    return {
        userId: 'u1', version: 1, fullName: 'Purvesh Arve', fullNameScript: 'latn', nameMr: null, nameEn: null, phone: '+918888888888',
        phoneVerifiedAtUtc: '2026-11-20T10:00:00Z', farmerId: null,
        village: { lgdCode: null, nameMr: null, nameEn: 'Pimpalgaon', basis: 'NotInList' },
        taluka: { lgdCode: null, nameMr: null, nameEn: 'Niphad', basis: 'NotInList' },
        district: { lgdCode: null, nameMr: null, nameEn: 'Nashik', basis: 'NotInList' },
        placeListVersion: null, pinCode: null, photo: null, complete: true, updatedAtUtc: '2026-11-20T10:00:00Z', ...over,
    };
}

export function identityApiStub(over: Partial<MyIdentity> = {}) {
    const card = stubCard(over);
    return {
        getMyIdentity: async (): Promise<IdentityCallResult> => ({ kind: 'ok', card }),
        putMyIdentity: async (): Promise<IdentityCallResult> => ({ kind: 'ok', card }),
    };
}
