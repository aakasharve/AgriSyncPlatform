/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6) - the phone's two calls to the person's own card
 * (`GET` / `PUT /user/auth/me/identity`): every answer becomes a value the screen can say, never a throw; the card is read leniently (P11: a field a
 * newer server adds is ignored); the body names no user (the token's person only) and never a Farmer ID status.
 */
import { describe, expect, it, vi } from 'vitest';
import { getMyIdentity, putMyIdentity, type IdentityHttp, type IdentityPutBody } from '../identityApi';

const CARD = {
    userId: 'u1', version: 3, fullName: 'Purvesh Chandrashekhar Arve', fullNameScript: 'latn',
    nameMr: { value: 'पूर्वेश चंद्रशेखर आरवे', basis: 'ConvertedConfirmed' }, nameEn: null,
    phone: '+919999912345', phoneVerifiedAtUtc: '2026-11-20T10:00:00Z',
    farmerId: { value: '12345678901', status: 'Unverified' },
    village: { lgdCode: 944182, nameMr: 'पंढरपूर', nameEn: 'Pandharpur', basis: 'List' },
    taluka: { lgdCode: 4249, nameMr: null, nameEn: 'Pandharpur', basis: 'List' },
    district: { lgdCode: 496, nameMr: 'सोलापूर', nameEn: 'Solapur', basis: 'List' },
    placeListVersion: 'lgd-mh-2026-11-26', pinCode: { value: '413304', basis: 'FromVillageList' },
    photo: null, complete: true, updatedAtUtc: '2026-11-27T09:00:00Z',
};

const axiosError = (status: number | null, data?: unknown) => Object.assign(new Error('x'), status === null ? {} : { response: { status, data } });

const http = (impl: Partial<IdentityHttp>): IdentityHttp => ({
    get: vi.fn(async () => { throw new Error('unused'); }),
    put: vi.fn(async () => { throw new Error('unused'); }),
    ...impl,
});

const BODY: IdentityPutBody = {
    expectedVersion: 3, fullName: 'Raju Bhosale', nameMr: null, nameEn: null, farmerId: null,
    village: { lgdCode: 944182, typedFallback: 'पंढरपूर' }, taluka: null, district: null,
    placeListVersion: 'lgd-mh-2026-11-26', pinCode: null,
};

describe('GET /user/auth/me/identity', () => {
    it('reads the card, ignoring a field a newer server adds', async () => {
        const h = http({ get: vi.fn(async () => ({ status: 200, data: { ...CARD, somethingNew: 1 } })) });
        const r = await getMyIdentity(h);
        expect(h.get).toHaveBeenCalledWith('/user/auth/me/identity');
        expect(r.kind).toBe('ok');
        if (r.kind === 'ok') {
            expect(r.card.village?.lgdCode).toBe(944182);
            expect(r.card.complete).toBe(true);
            expect('somethingNew' in r.card).toBe(false);
        }
    });

    it('a body that is not a card is a failure, never a card', async () => {
        const r = await getMyIdentity(http({ get: vi.fn(async () => ({ status: 200, data: { hello: 'x' } })) }));
        expect(r).toEqual({ kind: 'failed', status: 200 });
    });

    it('no answer at all (no network) reads as offline', async () => {
        expect(await getMyIdentity(http({ get: vi.fn(async () => { throw axiosError(null); }) }))).toEqual({ kind: 'offline' });
    });
});

describe('PUT /user/auth/me/identity', () => {
    it('sends the whole card as given (no user id, no Farmer ID status) and reads the stored card back', async () => {
        const put = vi.fn(async () => ({ status: 200, data: { ...CARD, downgraded: [] } }));
        const r = await putMyIdentity(BODY, http({ put }));
        expect(put).toHaveBeenCalledWith('/user/auth/me/identity', BODY);
        const sent = (put.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
        expect(sent).not.toHaveProperty('userId');
        expect(JSON.stringify(sent)).not.toContain('status');
        expect(r.kind).toBe('ok');
        if (r.kind === 'ok') expect(r.card.downgraded).toEqual([]);
    });

    it('409 identity.stale: another phone saved first; nothing changed; its version is read', async () => {
        const put = vi.fn(async () => { throw axiosError(409, { error: 'identity.stale', message: 'This card was changed from another phone first. Nothing was saved.', currentVersion: 4 }); });
        expect(await putMyIdentity(BODY, http({ put }))).toEqual({ kind: 'stale', currentVersion: 4 });
    });

    it('400 with an identity code: refused with that code (the screen says it in its own words)', async () => {
        const put = vi.fn(async () => { throw axiosError(400, { error: 'identity.pin_invalid', message: 'A PIN is six digits and does not start with 0. Nothing was saved.' }); });
        expect(await putMyIdentity(BODY, http({ put }))).toEqual({ kind: 'refused', code: 'identity.pin_invalid' });
    });

    it('a server error or a 401 after the refresh is a failure (kept to send again); no network is offline', async () => {
        expect(await putMyIdentity(BODY, http({ put: vi.fn(async () => { throw axiosError(503, {}); }) }))).toEqual({ kind: 'failed', status: 503 });
        expect(await putMyIdentity(BODY, http({ put: vi.fn(async () => { throw axiosError(401, {}); }) }))).toEqual({ kind: 'failed', status: 401 });
        expect(await putMyIdentity(BODY, http({ put: vi.fn(async () => { throw axiosError(null); }) }))).toEqual({ kind: 'offline' });
    });
});
