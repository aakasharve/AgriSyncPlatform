// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6; drawing V2-A card 2) - "माझी ओळख", driven with REAL typing (user-event;
 * an earlier UI lane passed unit tests and broke real sign-in through a focus trick):
 *   - his own name and his seat's title; a waiting seat shows no title;
 *   - an English name offers a GREYED Marathi suggestion that is sent only after "बरोबर", with its basis;
 *   - a village is found by typing and picked from the government list: the taluka is left out in Marathi mode (Q8), the district is the list's,
 *     the list's PIN is offered (never filled silently);
 *   - a place not in the list is kept exactly as typed;
 *   - the Farmer ID says "पडताळलेला नाही" whenever it has a value, never a tick; "सत्यापित" only for the server's proven number;
 *   - offline: "पाठवायचं बाकी", never पूर्ण; a broken rule is said at the box in Marathi, nothing sent;
 *   - the 8-day ask on his own card, only from day 8;
 *   - Marathi mode shows no English word (names, place names and "Farmer ID" as drawn are data, not words).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        uiPrefs: {
            get: async (key: string) => (rows.has(key) ? { key, value: rows.get(key) } : undefined),
            put: async (row: { key: string; value: unknown }) => { rows.set(row.key, row.value); },
        },
    }),
}));
vi.mock('../../../infrastructure/storage/activeDatabaseName', () => ({ onActiveDatabaseChanged: () => () => { /* none */ } }));
vi.mock('../../../infrastructure/api/apiFetch', () => ({ apiFetch: vi.fn(async () => new Response(null, { status: 404 })) }));

import { MyIdentityCard } from '../MyIdentityCard';
import type { MyIdentityState } from '../useMyIdentity';
import type { MyIdentity } from '../identityApi';
import { bodyFromForm, type IdentityForm } from '../identityForm';
import { releasePlaceData } from '../placeData';

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const files = {
    tsv: readFileSync(at('../../../../public/places/lgd-mh-2026-11-26.tsv'), 'utf8'),
    areas: readFileSync(at('../../../../public/places/lgd-mh-2026-11-26-areas.json'), 'utf8'),
};
const placeSource = async () => files;

const card = (over: Partial<MyIdentity> = {}): MyIdentity => ({
    userId: 'u-raju', version: 1, fullName: 'Ganesh Pawar', fullNameScript: 'latn', nameMr: null, nameEn: null, phone: '+919999954321',
    phoneVerifiedAtUtc: '2026-11-20T10:00:00Z', farmerId: null, village: null, taluka: null, district: null, placeListVersion: null,
    pinCode: null, photo: null, complete: false, updatedAtUtc: '2026-11-20T10:00:00Z', ...over,
});

const state = (over: Partial<MyIdentityState> = {}): MyIdentityState & { sent: IdentityForm[] } => {
    const sent: IdentityForm[] = [];
    return {
        sent, card: card(), loaded: true, pending: null, saveState: 'idle', refusedCode: null, unsentForm: null,
        save: vi.fn(async (f: IdentityForm) => { sent.push(f); }), reload: vi.fn(async () => {}), ...over,
    };
};

const mount = (s: MyIdentityState, props: Partial<React.ComponentProps<typeof MyIdentityCard>> = {}) =>
    render(<MyIdentityCard userId="u-raju" identity={s} language="mr" role="Worker" ownDisplayName="Ganesh Pawar" placeSource={placeSource}
        now={() => new Date('2026-11-23T00:00:00Z')} {...props} />);

beforeEach(() => { rows.clear(); });
afterEach(() => { cleanup(); releasePlaceData(); });

describe('माझी ओळख — whose card, which title', () => {
    it('his own name (the server\'s), and his seat\'s title on the open farm', () => {
        mount(state());
        expect(screen.getByTestId('my-identity-name')).toHaveTextContent('Ganesh Pawar');
        expect(screen.getByTestId('my-identity-title')).toHaveTextContent('कामगार');
        expect(screen.getByTestId('my-identity-initial')).toHaveTextContent('G');
    });

    it('Marathi mode shows his Marathi name; the main owner reads शेतमालक; a waiting seat shows no title', () => {
        mount(state({ card: card({ nameMr: { value: 'गणेश पवार', basis: 'Typed' } }) }), { role: 'PrimaryOwner' });
        expect(screen.getByTestId('my-identity-name')).toHaveTextContent('गणेश पवार');
        expect(screen.getByTestId('my-identity-title')).toHaveTextContent('शेतमालक');
        expect(screen.getByTestId('my-identity-initial')).toHaveTextContent('ग');
        cleanup();
        mount(state(), { role: null });
        expect(screen.queryByTestId('my-identity-title')).toBeNull();
    });

    it('the photo line says who sees it (Q2 = B), true for every role', () => {
        mount(state());
        expect(screen.getByTestId('my-identity-photo-line')).toHaveTextContent('कामगारांना फक्त मालक, सहमालक आणि मुकादमांचे फोटो दिसतात');
    });
});

describe('माझी ओळख — the Marathi name (no AI, Q4 = A)', () => {
    it('an English name gets a GREYED Marathi suggestion; it is sent only after "बरोबर", as ConvertedConfirmed', async () => {
        const user = userEvent.setup();
        const s = state();
        mount(s);
        const suggestion = await screen.findByTestId('id-other-name-suggestion');
        expect(suggestion).toHaveTextContent('गणेश पवार');
        expect(screen.getByTestId('id-other-name-input')).toHaveValue('');
        await user.click(screen.getByTestId('id-save'));
        expect(bodyFromForm(s.sent[0], 1).nameMr).toBeNull();
        await user.click(screen.getByTestId('id-other-name-confirm'));
        expect(screen.getByTestId('id-other-name-input')).toHaveValue('गणेश पवार');
        await user.click(screen.getByTestId('id-save'));
        expect(bodyFromForm(s.sent[1], 1).nameMr).toEqual({ value: 'गणेश पवार', basis: 'ConvertedConfirmed' });
    });

    it('a name the list is not sure of: an empty box with "मराठीत नाव लिहा"; what he types goes as Typed', async () => {
        const user = userEvent.setup();
        const s = state({ card: card({ fullName: 'Purvesh Chandrashekhar Arve' }) });
        mount(s, { ownDisplayName: 'Purvesh Chandrashekhar Arve' });
        await waitFor(() => expect(screen.getByTestId('id-other-name-hint')).toHaveTextContent('मराठीत नाव लिहा'));
        expect(screen.queryByTestId('id-other-name-suggestion')).toBeNull();
        await user.type(screen.getByTestId('id-other-name-input'), 'पूर्वेश आरवे');
        await user.click(screen.getByTestId('id-save'));
        expect(bodyFromForm(s.sent[0], 1).nameMr).toEqual({ value: 'पूर्वेश आरवे', basis: 'Typed' });
    });

    it('a Marathi full name gets an "इंग्रजीत नाव" box with the rules\' suggestion', async () => {
        mount(state({ card: card({ fullName: 'पूर्वेश चंद्रशेखर आरवे', fullNameScript: 'deva' }) }));
        expect(screen.getByTestId('id-other-name')).toHaveTextContent('इंग्रजीत नाव');
        expect(screen.getByTestId('id-other-name-suggestion')).toHaveTextContent('Purvesh Chandrashekhar Arve');
    });

    it('Latin letters in the Marathi box are said at the box and nothing is sent', async () => {
        const user = userEvent.setup();
        const s = state();
        mount(s);
        await user.type(screen.getByTestId('id-other-name-input'), 'Ganesh');
        await user.click(screen.getByTestId('id-save'));
        expect(screen.getByTestId('id-other-name-problem')).toHaveTextContent('इथे फक्त मराठी अक्षरं चालतात');
        expect(s.save).not.toHaveBeenCalled();
    });
});

describe('माझी ओळख — गाव, तालुका, जिल्हा from the government list', () => {
    it('typing "पंढ" finds पंढरपूर (जि. सोलापूर); picking it sets the district from the list, leaves the taluka out (Q8), offers the PIN', async () => {
        const user = userEvent.setup();
        const s = state();
        mount(s);
        await user.type(screen.getByTestId('id-village-input'), 'पंढ');
        const list = await screen.findByTestId('id-village-rows');
        const row = (await within(list).findAllByTestId('id-village-row')).find(r => r.textContent === 'पंढरपूरजि. सोलापूर');
        expect(row).toBeTruthy();
        // No English taluka name anywhere in the rows (Q8 open).
        expect(list.textContent).not.toMatch(/Pandharpur|ता\./);
        await user.click(row!);
        expect(screen.getByTestId('id-village-input')).toHaveValue('पंढरपूर');
        expect(screen.queryByTestId('id-taluka')).toBeNull();
        expect(screen.getByTestId('id-district-derived')).toHaveTextContent('सोलापूर');
        expect(screen.getByTestId('id-district-derived')).toHaveTextContent('गावावरून');
        // The list's PIN is offered, never filled silently.
        expect(screen.getByTestId('id-pin-input')).toHaveValue('');
        await user.click(screen.getByTestId('id-pin-from-list'));
        expect(screen.getByTestId('id-pin-input')).toHaveValue('413304');
        await user.click(screen.getByTestId('id-save'));
        const body = bodyFromForm(s.sent[0], 1);
        expect(body.village).toEqual({ lgdCode: 944182, typedFallback: 'पंढरपूर' });
        expect(body.taluka).toBeNull();
        expect(body.district).toBeNull();
        expect(body.pinCode).toEqual({ value: '413304', basis: 'FromVillageList' });
    });

    it('a place not in the list is kept exactly as typed, with a "यादीत नाही" chip', async () => {
        const user = userEvent.setup();
        const s = state();
        mount(s);
        await user.type(screen.getByTestId('id-village-input'), 'वाडी नं. ५');
        await user.click(await screen.findByTestId('id-village-keep'));
        expect(screen.getByTestId('id-village-not-in-list')).toHaveTextContent('यादीत नाही');
        await user.type(screen.getByTestId('id-taluka-input'), 'पंढरपूर');
        expect(screen.queryAllByTestId('id-taluka-row')).toHaveLength(0); // no Marathi taluka names in the list
        await user.click(screen.getByTestId('id-taluka-keep'));
        await user.click(screen.getByTestId('id-save'));
        const body = bodyFromForm(s.sent[0], 1);
        expect(body.village).toEqual({ typed: 'वाडी नं. ५' });
        expect(body.taluka).toEqual({ typed: 'पंढरपूर' });
    });

    it('letters typed but not picked: the box says so (and the earlier choice is what would be sent)', async () => {
        const user = userEvent.setup();
        mount(state());
        await user.type(screen.getByTestId('id-village-input'), 'पंढ');
        expect(screen.getByTestId('id-village-not-chosen')).toHaveTextContent('अजून निवडलं नाही');
    });
});

describe('माझी ओळख — Farmer ID, phone, save', () => {
    it('the Farmer ID says "पडताळलेला नाही" whenever it has a value; never a tick', async () => {
        const user = userEvent.setup();
        mount(state());
        expect(screen.queryByTestId('id-farmer-id-unverified')).toBeNull();
        await user.type(screen.getByTestId('id-farmer-id-input'), '12345678901');
        expect(screen.getByTestId('id-farmer-id-unverified')).toHaveTextContent('पडताळलेला नाही');
        expect(screen.getByTestId('id-farmer-id').querySelector('svg')).toBeNull();
    });

    it('"सत्यापित" only when the server says a code proved the number', () => {
        mount(state());
        expect(screen.getByTestId('id-phone')).toHaveTextContent('+91 99999 54321');
        expect(screen.getByTestId('id-phone-verified')).toHaveTextContent('सत्यापित');
        cleanup();
        mount(state({ card: card({ phoneVerifiedAtUtc: null }) }));
        expect(screen.queryByTestId('id-phone-verified')).toBeNull();
    });

    it('a PIN starting with 0 is said at the box and nothing is sent; a blank full name too', async () => {
        const user = userEvent.setup();
        const s = state();
        mount(s);
        await user.type(screen.getByTestId('id-pin-input'), '013304');
        await user.click(screen.getByTestId('id-save'));
        expect(screen.getByTestId('id-pin-problem')).toHaveTextContent('पिनकोड ६ अंकी असतो आणि ० ने सुरू होत नाही');
        await user.clear(screen.getByTestId('id-full-name-input'));
        await user.click(screen.getByTestId('id-save'));
        expect(screen.getByTestId('id-full-name-problem')).toHaveTextContent('पूर्ण नाव भरा');
        expect(s.save).not.toHaveBeenCalled();
    });

    it('offline: "पाठवायचं बाकी — इंटरनेट आल्यावर जाईल" (his edits kept), never "जतन झाली"', () => {
        const pendingForm: IdentityForm = { fullName: 'Ganesh Pawar', nameMr: null, nameEn: null, farmerId: '', village: { kind: 'typed', text: 'वाडी' }, taluka: null, district: null, pin: null };
        mount(state({ saveState: 'pending', pending: { body: bodyFromForm(pendingForm, 1), form: pendingForm, at: '' } }));
        expect(screen.getByTestId('id-save-status')).toHaveTextContent('पाठवायचं बाकी — इंटरनेट आल्यावर जाईल');
        expect(screen.getByTestId('id-save-status').textContent).not.toContain('जतन झाली');
        expect(screen.getByTestId('id-village-input')).toHaveValue('वाडी');
    });

    it('saved by the server but places missing: "जतन झाली", and it says when it will be complete (Q3 = B)', () => {
        mount(state({ saveState: 'saved' }));
        expect(screen.getByTestId('id-save-status')).toHaveTextContent('माहिती जतन झाली. गाव, तालुका आणि जिल्हा भरल्यावर माझी ओळख पूर्ण होईल.');
    });

    it('another phone saved first: it says so, shows what is saved now, and keeps his edits', () => {
        const mine: IdentityForm = { fullName: 'Ganesh P', nameMr: null, nameEn: null, farmerId: '', village: null, taluka: null, district: null, pin: null };
        mount(state({ saveState: 'stale', unsentForm: mine, card: card({ version: 4, fullName: 'Ganesh Pawar' }) }));
        expect(screen.getByTestId('id-save-status')).toHaveTextContent('ही माहिती दुसऱ्या फोनवरून आधी बदलली');
        expect(screen.getByTestId('my-identity-stale-now')).toHaveTextContent('Ganesh Pawar');
        expect(screen.getByTestId('id-full-name-input')).toHaveValue('Ganesh P');
    });
});

describe('माझी ओळख — the 8-day ask (Q5 = A)', () => {
    it('not before day 8 of his last save; on day 8 it asks with the suggestion; "नंतर" puts it off', async () => {
        const user = userEvent.setup();
        mount(state(), { now: () => new Date('2026-11-28T09:59:00Z') });
        await screen.findByTestId('id-other-name-suggestion');
        expect(screen.queryByTestId('my-identity-ask')).toBeNull();
        cleanup();
        mount(state(), { now: () => new Date('2026-11-28T12:00:00Z') });
        const ask = await screen.findByTestId('my-identity-ask');
        expect(ask).toHaveTextContent('तुमचं नाव मराठीत असं लिहायचं का?');
        expect(ask).toHaveTextContent('गणेश पवार');
        await user.click(screen.getByTestId('my-identity-ask-later'));
        await waitFor(() => expect(rows.get('identity:askLater:u-raju')).toBe('2026-12-06T12:00:00.000Z'));
    });

    it('"बरोबर" on the ask saves the name as confirmed', async () => {
        const user = userEvent.setup();
        const s = state();
        mount(s, { now: () => new Date('2026-12-01T00:00:00Z') });
        await user.click(await screen.findByTestId('my-identity-ask-confirm'));
        expect(bodyFromForm(s.sent[0], 1).nameMr).toEqual({ value: 'गणेश पवार', basis: 'ConvertedConfirmed' });
    });
});

describe('माझी ओळख — one language', () => {
    it('Marathi mode: no English word (his name and place names are data)', async () => {
        const user = userEvent.setup();
        mount(state({ card: card({ fullName: 'गणेश पवार', fullNameScript: 'deva', nameEn: { value: 'Ganesh Pawar', basis: 'Typed' } }) }), { role: 'Mukadam' });
        await user.type(screen.getByTestId('id-village-input'), 'पंढ');
        await screen.findAllByTestId('id-village-row');
        const text = (screen.getByTestId('hub-my-identity').textContent ?? '').replace(/Ganesh Pawar|\+91 \d{5} \d{5}/g, ' ');
        expect(text).not.toMatch(/[A-Za-z]{3,}/);
    });

    it('English mode: no Marathi word', () => {
        mount(state(), { language: 'en', role: 'PrimaryOwner' });
        const card2 = screen.getByTestId('hub-my-identity');
        expect(card2.textContent).not.toMatch(/[ऀ-ॿ]/);
        expect(screen.getByTestId('my-identity-title')).toHaveTextContent('Farm owner');
        expect(screen.getByTestId('id-other-name')).toHaveTextContent('Name in Marathi');
    });
});
