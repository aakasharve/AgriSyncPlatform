/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6) - the card form and the body it sends. A village picked from the list is
 * sent by its code (the server fills the taluka and district from ITS list); a place typed by hand is sent exactly as typed; nothing the phone only
 * suggested is ever in the body; the checks match the server's rules so a refusal is said at the box, in his language.
 */
import { describe, expect, it } from 'vitest';
import { bodyFromForm, formFromCard, problemsOf, type IdentityForm } from '../identityForm';
import type { MyIdentity } from '../identityApi';
import { PLACE_LIST_VERSION } from '../../../domain/places/placeList';

const empty: IdentityForm = {
    fullName: 'Raju Bhosale', nameMr: null, nameEn: null, farmerId: '', village: null, taluka: null, district: null, pin: null,
};

describe('formFromCard', () => {
    it('reads a listed place as the list choice and a typed one as its text', () => {
        const card = {
            userId: 'u1', version: 2, fullName: 'Raju Bhosale', fullNameScript: 'latn', nameMr: null, nameEn: null, phone: '+919999954321',
            phoneVerifiedAtUtc: null, farmerId: null,
            village: { lgdCode: null, nameMr: 'वाडी नं. ५', nameEn: null, basis: 'NotInList' },
            taluka: { lgdCode: 4249, nameMr: null, nameEn: 'Pandharpur', basis: 'List' },
            district: { lgdCode: 496, nameMr: 'सोलापूर', nameEn: 'Solapur', basis: 'List' },
            placeListVersion: PLACE_LIST_VERSION, pinCode: { value: '413304', basis: 'Typed' }, photo: null, complete: true, updatedAtUtc: null,
        } satisfies MyIdentity;
        const form = formFromCard(card, 'ignored');
        expect(form.village).toEqual({ kind: 'typed', text: 'वाडी नं. ५' });
        expect(form.taluka).toEqual({ kind: 'list', code: 4249, nameMr: null, nameEn: 'Pandharpur' });
        expect(form.pin).toEqual({ value: '413304', basis: 'Typed' });
    });

    it('no card yet: the server\'s own display name (never the farm owner\'s), everything else empty', () => {
        expect(formFromCard(null, 'Raju Bhosale')).toEqual(empty);
    });
});

describe('bodyFromForm', () => {
    it('a village from the list goes by its code with the shown name as fallback; the server fills taluka and district', () => {
        const body = bodyFromForm({ ...empty, village: { kind: 'list', code: 944182, nameMr: 'पंढरपूर', nameEn: 'Pandharpur' },
            taluka: { kind: 'list', code: 4249, nameMr: null, nameEn: 'Pandharpur' } }, 3);
        expect(body).toMatchObject({
            expectedVersion: 3, village: { lgdCode: 944182, typedFallback: 'पंढरपूर' }, taluka: null, district: null, placeListVersion: PLACE_LIST_VERSION,
        });
    });

    it('a typed village keeps its text byte for byte; a listed taluka goes by code and its district is left to the server', () => {
        const body = bodyFromForm({ ...empty, village: { kind: 'typed', text: '  वाडी नं. ५' }, taluka: { kind: 'list', code: 4249, nameMr: null, nameEn: 'Pandharpur' },
            district: { kind: 'list', code: 496, nameMr: 'सोलापूर', nameEn: 'Solapur' } }, 0);
        expect(body.village).toEqual({ typed: '  वाडी नं. ५' });
        expect(body.taluka).toEqual({ lgdCode: 4249 });
        expect(body.district).toBeNull();
        expect(body.placeListVersion).toBe(PLACE_LIST_VERSION);
    });

    it('nothing from the list: no list version; PIN in Marathi digits goes as ASCII digits; blank Farmer ID is none', () => {
        const body = bodyFromForm({ ...empty, district: { kind: 'typed', text: 'सोलापूर' }, pin: { value: '४१३३०४', basis: 'Typed' }, farmerId: '  ' }, 1);
        expect(body.placeListVersion).toBeNull();
        expect(body.pinCode).toEqual({ value: '413304', basis: 'Typed' });
        expect(body.farmerId).toBeNull();
        expect(body.district).toEqual({ typed: 'सोलापूर' });
    });

    it('the other-script names go only as he confirmed or typed them', () => {
        const body = bodyFromForm({ ...empty, nameMr: { value: ' राजू भोसले ', basis: 'ConvertedConfirmed' } }, 1);
        expect(body.nameMr).toEqual({ value: 'राजू भोसले', basis: 'ConvertedConfirmed' });
        expect(body.nameEn).toBeNull();
        expect(JSON.stringify(body)).not.toMatch(/Unconfirmed|userId|status/);
    });
});

describe('problemsOf (the server\'s rules, said at the box)', () => {
    it('a blank full name', () => {
        expect(problemsOf({ ...empty, fullName: '   ' }).fullName).toBe('fullNameRequired');
        expect(problemsOf(empty)).toEqual({});
    });

    it('a PIN is six digits not starting with 0 (Marathi digits are fine)', () => {
        expect(problemsOf({ ...empty, pin: { value: '४१३३०४', basis: 'Typed' } }).pin).toBeUndefined();
        expect(problemsOf({ ...empty, pin: { value: '013304', basis: 'Typed' } }).pin).toBe('pinInvalid');
        expect(problemsOf({ ...empty, pin: { value: '4133', basis: 'Typed' } }).pin).toBe('pinInvalid');
    });

    it('a Farmer ID of digits, English letters, spaces and - only, at most 32', () => {
        expect(problemsOf({ ...empty, farmerId: 'MH-1234 56' }).farmerId).toBeUndefined();
        expect(problemsOf({ ...empty, farmerId: '१२३४५' }).farmerId).toBeUndefined();
        expect(problemsOf({ ...empty, farmerId: '12/34' }).farmerId).toBe('farmerIdInvalid');
        expect(problemsOf({ ...empty, farmerId: '1'.repeat(33) }).farmerId).toBe('farmerIdInvalid');
    });

    it('the Marathi box holds Marathi letters only, the English box English letters only', () => {
        expect(problemsOf({ ...empty, nameMr: { value: 'Raju', basis: 'Typed' } }).nameMr).toBe('nameMrScript');
        expect(problemsOf({ ...empty, fullName: 'राजू भोसले', nameEn: { value: 'राजू', basis: 'Typed' } }).nameEn).toBe('nameEnScript');
    });
});
