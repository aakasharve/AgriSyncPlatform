/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6) - the "माझी ओळख" form, pure: how a stored card fills it, the body a save
 * sends, and the checks that match the server's rules (so a refusal is said at the box, in his language, before anything is sent).
 *
 *   - A place picked from the list is sent by its LGD code (with the name the phone showed as `typedFallback`); a place derived from a higher
 *     choice (the taluka and district of a listed village, the district of a listed taluka) is sent as null: the server fills it from ITS list.
 *   - A place typed by hand is sent exactly as typed (P8: basis NotInList on the server).
 *   - Only names he typed or confirmed are in the form; an unconfirmed suggestion never is (P1).
 */
import { PLACE_LIST_VERSION } from '../../domain/places/placeList';
import { isEnglishName, isMarathiName } from '../../domain/names/nameScript';
import type { IdentityPlaceDto, IdentityPutBody, MyIdentity, NameBasis, PinBasis, PlacePart } from './identityApi';

export type PlaceValue =
    | { kind: 'list'; code: number; nameMr: string | null; nameEn: string }
    | { kind: 'typed'; text: string }
    | null;

export interface IdentityForm {
    fullName: string;
    nameMr: { value: string; basis: NameBasis } | null;
    nameEn: { value: string; basis: NameBasis } | null;
    farmerId: string;
    village: PlaceValue;
    taluka: PlaceValue;
    district: PlaceValue;
    pin: { value: string; basis: PinBasis } | null;
}

export type FieldProblem = 'fullNameRequired' | 'pinInvalid' | 'farmerIdInvalid' | 'nameMrScript' | 'nameEnScript';
export type FormProblems = Partial<Record<'fullName' | 'pin' | 'farmerId' | 'nameMr' | 'nameEn', FieldProblem>>;

const MARATHI_DIGITS = '०१२३४५६७८९';
/** Marathi digits as ASCII digits; every other character unchanged (the server reads them the same way). */
export const asciiDigits = (s: string): string => s.replace(/[०-९]/g, d => String(MARATHI_DIGITS.indexOf(d)));

const asBasis = (b: string): NameBasis => (b === 'ConvertedConfirmed' ? 'ConvertedConfirmed' : 'Typed');

function placeFromCard(p: IdentityPlaceDto | null): PlaceValue {
    if (!p) return null;
    if (p.basis === 'List' && p.lgdCode !== null) return { kind: 'list', code: p.lgdCode, nameMr: p.nameMr, nameEn: p.nameEn ?? p.nameMr ?? '' };
    const text = p.nameMr ?? p.nameEn;
    return text ? { kind: 'typed', text } : null;
}

/** The form for a stored card; with no card yet, the server's own display name for him (never the farm owner's name). */
export function formFromCard(card: MyIdentity | null, ownDisplayName: string): IdentityForm {
    if (!card) {
        return { fullName: ownDisplayName, nameMr: null, nameEn: null, farmerId: '', village: null, taluka: null, district: null, pin: null };
    }
    return {
        fullName: card.fullName,
        nameMr: card.nameMr ? { value: card.nameMr.value, basis: asBasis(card.nameMr.basis) } : null,
        nameEn: card.nameEn ? { value: card.nameEn.value, basis: asBasis(card.nameEn.basis) } : null,
        farmerId: card.farmerId?.value ?? '',
        village: placeFromCard(card.village),
        taluka: placeFromCard(card.taluka),
        district: placeFromCard(card.district),
        pin: card.pinCode ? { value: card.pinCode.value, basis: card.pinCode.basis === 'FromVillageList' ? 'FromVillageList' : 'Typed' } : null,
    };
}

function part(p: PlaceValue): PlacePart | null {
    if (!p) return null;
    if (p.kind === 'list') return { lgdCode: p.code };
    return p.text.trim() ? { typed: p.text } : null;
}

const name = (n: IdentityForm['nameMr']) => (n && n.value.trim() ? { value: n.value.trim(), basis: n.basis } : null);

/** The PUT body of this form (a whole replace), against the version the phone last read. */
export function bodyFromForm(form: IdentityForm, expectedVersion: number): IdentityPutBody {
    const villageListed = form.village?.kind === 'list';
    const talukaListed = form.taluka?.kind === 'list';
    const village: PlacePart | null = form.village?.kind === 'list'
        ? { lgdCode: form.village.code, typedFallback: form.village.nameMr ?? form.village.nameEn }
        : part(form.village);
    const taluka = villageListed ? null : part(form.taluka);
    const district = villageListed || talukaListed ? null : part(form.district);
    const anyListed = [village, taluka, district].some(p => p !== null && 'lgdCode' in p);
    const pinDigits = form.pin ? asciiDigits(form.pin.value).replace(/\s/g, '') : '';
    const farmerId = asciiDigits(form.farmerId).trim();
    return {
        expectedVersion,
        fullName: form.fullName.trim(),
        nameMr: name(form.nameMr),
        nameEn: name(form.nameEn),
        farmerId: farmerId || null,
        village,
        taluka,
        district,
        placeListVersion: anyListed ? PLACE_LIST_VERSION : null,
        pinCode: form.pin && pinDigits ? { value: pinDigits, basis: form.pin.basis } : null,
    };
}

const PIN = /^[1-9][0-9]{5}$/;
const FARMER_ID = /^[0-9A-Za-z -]{1,32}$/;

/** The boxes the server would refuse, by the server's own rules. Empty = the card can be sent. */
export function problemsOf(form: IdentityForm): FormProblems {
    const out: FormProblems = {};
    if (!form.fullName.trim()) out.fullName = 'fullNameRequired';
    const pin = form.pin ? asciiDigits(form.pin.value).replace(/\s/g, '') : '';
    if (pin && !PIN.test(pin)) out.pin = 'pinInvalid';
    const farmerId = asciiDigits(form.farmerId).trim();
    if (farmerId && !FARMER_ID.test(farmerId)) out.farmerId = 'farmerIdInvalid';
    if (form.nameMr?.value.trim() && !isMarathiName(form.nameMr.value.trim())) out.nameMr = 'nameMrScript';
    if (form.nameEn?.value.trim() && !isEnglishName(form.nameEn.value.trim())) out.nameEn = 'nameEnScript';
    return out;
}

/** A server refusal code as the box it belongs to (the server's words are English; the screen says its own). */
export function problemOfRefusal(code: string): { field: keyof FormProblems; problem: FieldProblem } | null {
    switch (code) {
        case 'identity.full_name_required': return { field: 'fullName', problem: 'fullNameRequired' };
        case 'identity.pin_invalid': return { field: 'pin', problem: 'pinInvalid' };
        case 'identity.farmer_id_invalid': return { field: 'farmerId', problem: 'farmerIdInvalid' };
        default: return null;
    }
}
