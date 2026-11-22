// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: facts2-did-you-mean-2026-11-20 (founder 2026-11-20: "yes, add it") - a product word the library does not know EXACTLY gets the
 * library names that sound like it, as buttons. His tap is the same "हो, हेच" answer naming that product; nothing is chosen for him
 * (P1), what he said is kept as he said it (P7), a "नाही" is no pick, and a word with no sound-alike or an exact word shows none.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const lang = { current: 'mr' as 'mr' | 'en' };
    (globalThis as unknown as { __lang: typeof lang }).__lang = lang;
    const ctx = () => ({ language: lang.current, setLanguage: () => undefined, t: (k: string) => t(k, lang.current) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import type { DailyLog, InputIdentityAnswer } from '../../../../../domain/types/log.types';
import { identityOf, pickedProductOf } from '../inputIdentityModel';
import { productBoxesOf } from '../productModel';
import ProductCard, { type ProductAnswerKit } from '../ProductCard';
import { ProductRow } from '../ProductRows';

const LOG = 'e5e5e5e5-0000-4000-8000-000000000005';
const KARATE = 'p-lambda-cyhalothrin-5-ec';
const setLang = (l: 'mr' | 'en') => { (globalThis as unknown as { __lang: { current: string } }).__lang.current = l; };

const answer = (verdict: InputIdentityAnswer['verdict'], over: Partial<InputIdentityAnswer> = {}): InputIdentityAnswer => ({
    assertionId: 'as-1', inputEventId: 'ev-1', mixIndex: 0, verdict, ...(verdict === 'confirmed' ? { catalogProductId: KARATE } : {}),
    catalogVersion: 'inputs-2', assertedByUserId: 'user-1', assertedAtUtc: '2026-11-20T05:00:00.000Z', isCheck: false, ...over,
});

const logWith = (productName: string, answers: InputIdentityAnswer[] = []): DailyLog => ({
    id: LOG, date: '2026-11-20', cropActivities: [], irrigation: [], labour: [], machinery: [],
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['p1'], selectedPlotNames: ['प्लॉट १'] }] },
    inputs: [{ id: 'ev-1', method: 'Spray', mix: [{ id: 'm1', productName }] }],
    inputIdentities: answers,
}) as unknown as DailyLog;

const kitFor = (log: DailyLog): ProductAnswerKit => ({
    logById: new Map([[log.id, log]]), canCheck: false, canSeeMoney: false, nameOfUser: id => (id === 'user-1' ? 'सुनील' : 'अज्ञात'),
    cropNamesOf: () => ['Grapes'], onAnswer: vi.fn(async () => undefined), onPhoto: vi.fn(async () => undefined),
});

const show = (log: DailyLog, kit: ProductAnswerKit) => render(<ProductCard item={productBoxesOf(log)[0].items[0]} logId={log.id} kit={kit} onClose={vi.fn()} />);

afterEach(() => { cleanup(); setLang('mr'); });

describe('product card: did you mean (lane FACTS-2)', () => {
    it('ASpellingTheLibraryDoesNotHold_ShowsTheNamesThatSoundLikeIt_AsButtons_AndTheQuestion', () => {
        const log = logWith('Karatay');
        show(log, kitFor(log));
        expect(screen.getByTestId('vr-near-question').textContent).toBe('तुम्हाला हे म्हणायचं होतं का?');
        const button = screen.getByTestId(`vr-near-${KARATE}`);
        // Before his tap a candidate is its brand and its company, nothing else (CTO 2026-11-20).
        expect(button.textContent).toBe('कराटेसिंजेंटा');
        expect(screen.getByTestId('vr-near-hint').textContent).toContain('फोटो');
        // He is still shown to have said what he said, the photo is still offered, and NOTHING was chosen for him.
        expect(screen.getByTestId('vr-card-name').textContent).toBe('Karatay');
        expect(screen.getByTestId('vr-card-photo')).toBeTruthy();
        expect(screen.queryByTestId('vr-card-facts')).toBeNull();
        expect(screen.queryByTestId('vr-card-picked')).toBeNull();
    });

    it('BeforeAnyTap_NothingIsWritten_AndNothingFromTheLibraryAboutTheGuessIsShownButItsBrandAndCompany', () => {
        vi.stubEnv('VITE_FACTS_SHOW_UNTICKED', '1'); // even the test build, which shows unchecked lines, shows none for a guess
        const log = logWith('Karatay');
        const kit = kitFor(log);
        const { container } = show(log, kit);
        expect(kit.onAnswer).not.toHaveBeenCalled();
        expect(kit.onPhoto).not.toHaveBeenCalled();
        for (const id of ['vr-card-facts', 'vr-fact-ingredient', 'vr-fact-company', 'vr-card-does', 'vr-card-stage-lines', 'vr-fact-when', 'vr-fact-benefit', 'vr-card-picked', 'vr-card-speaker-said']) {
            expect(screen.queryByTestId(id), id).toBeNull();
        }
        // the guess's ingredient (Marathi and English) and its strength appear nowhere on the card
        expect(container.textContent).not.toMatch(/लॅम्बडा|सायहॅलोथ्रिन|Lambda|cyhalothrin|५%/i);
        vi.unstubAllEnvs();
    });

    it('TappingOne_IsTheSameYesThisAnswer_NamingThatProduct_NothingElse', async () => {
        const log = logWith('Karatay');
        const kit = kitFor(log);
        show(log, kit);
        fireEvent.click(screen.getByTestId(`vr-near-${KARATE}`));
        await vi.waitFor(() => expect(kit.onAnswer).toHaveBeenCalledTimes(1));
        expect(kit.onAnswer).toHaveBeenCalledWith(expect.objectContaining({ logId: LOG, verdict: 'confirmed', catalogProductId: KARATE }));
        expect(kit.onPhoto).not.toHaveBeenCalled();
    });

    it('AfterHisTap_TheCardIsTheProductsCard_AndSaysHeChoseIt_HisWordKept', () => {
        const log = logWith('Karatay', [answer('confirmed')]);
        show(log, kitFor(log));
        expect(screen.getByTestId('vr-card-name').textContent).toBe('Karatay');
        expect(screen.getByTestId('vr-card-picked').textContent).toBe('तुम्ही “Karatay” म्हणालात; लायब्ररीतलं “कराटे” तुम्ही निवडलं. नोंदीत तुमचे शब्द “Karatay” तसेच राहतात.');
        expect(screen.getByTestId('vr-fact-ingredient').textContent).toContain('लॅम्बडा');
        expect(screen.getByTestId('vr-card-source').textContent).toBe('माहिती: श्रमसफल लायब्ररी');
        expect(screen.queryByTestId('vr-card-near')).toBeNull();
        // He CHOSE it: the line never says he said "yes, this one" as if the library had matched his word.
        const line = screen.getByTestId('vr-card-speaker-said').textContent ?? '';
        expect(line).toBe('सुनीलने हे नाव निवडलं');
        expect(line).not.toMatch(/सांगितलं|हो, हेच/);
    });

    it('AnExactMatchWithAYes_KeepsTheOldWords_SaidYes_NotChose', () => {
        const log = logWith('Karate', [answer('confirmed')]);
        show(log, kitFor(log));
        expect(screen.getByTestId('vr-card-speaker-said').textContent).toBe('सुनीलने सांगितलं: हो, हेच');
        expect(screen.queryByTestId('vr-card-picked')).toBeNull();
    });

    it('ARejectedAnswer_IsNoPick_TheNamesAreOfferedAgain', () => {
        const log = logWith('Karatay', [answer('rejected')]);
        show(log, kitFor(log));
        expect(screen.queryByTestId('vr-card-picked')).toBeNull();
        expect(screen.getByTestId(`vr-near-${KARATE}`)).toBeTruthy();
    });

    it('APhotoAlreadyKept_NoNamesAreOffered', () => {
        const log = logWith('Karatay', [answer('photo', { attachmentId: 'ph-1' })]);
        show(log, kitFor(log));
        expect(screen.queryByTestId('vr-card-near')).toBeNull();
        expect(screen.getByTestId('vr-card-unknown')).toBeTruthy();
    });

    it('AnExactName_IsTheLibrarysOwnMatch_NoNamesNoPickNote', () => {
        const log = logWith('Karate');
        show(log, kitFor(log));
        expect(screen.queryByTestId('vr-card-near')).toBeNull();
        expect(screen.queryByTestId('vr-card-picked')).toBeNull();
        expect(screen.getByTestId('vr-card-facts')).toBeTruthy();
    });

    it('AWordNothingSoundsLike_OffersOnlyThePhoto_NoGuess', () => {
        const log = logWith('कोणतंतरी औषध');
        show(log, kitFor(log));
        expect(screen.queryByTestId('vr-card-near')).toBeNull();
        expect(screen.getByTestId('vr-card-photo')).toBeTruthy();
    });

    it('AShortOrCommonWord_IsNeverTurnedIntoAProduct', () => {
        for (const word of ['खत', 'पाणी', 'water']) {
            const log = logWith(word);
            const { unmount } = show(log, kitFor(log));
            expect(screen.queryByTestId('vr-card-near'), word).toBeNull();
            unmount();
        }
    });

    it('English_ShowsEnglishWordsAndTheEnglishBrand', () => {
        setLang('en');
        const log = logWith('Karatay');
        show(log, kitFor(log));
        expect(screen.getByTestId('vr-near-question').textContent).toBe('Did you mean one of these?');
        expect(screen.getByTestId(`vr-near-${KARATE}`).textContent).toBe('KarateSyngenta');
        expect(screen.getByTestId('vr-near-hint').textContent).toContain('photo');
    });

    it('English_AfterTheTap_SaysHeChoseIt_AndTheRecordKeepsHisWords', () => {
        setLang('en');
        const log = logWith('Karatay', [answer('confirmed')]);
        show(log, kitFor(log));
        expect(screen.getByTestId('vr-card-picked').textContent).toBe('You said “Karatay”; you chose “Karate” from the library. The record keeps your words “Karatay” as said.');
        expect(screen.getByTestId('vr-card-speaker-said').textContent).toBe('सुनील chose this name');
    });
});

describe('the answer model (lane FACTS-2)', () => {
    const item = (log: DailyLog) => productBoxesOf(log)[0].items[0];

    it('NotFound_BecomesFoundByPick_OnlyWithAConfirmedAnswerNamingAProduct', () => {
        const log = logWith('Karatay');
        expect(identityOf(item(log)).state).toBe('notFound');
        expect(identityOf(item(log), {}).state).toBe('notFound');
        expect(identityOf(item(log), { speaker: answer('rejected') }).state).toBe('notFound');
        expect(identityOf(item(log), { speaker: answer('photo', { attachmentId: 'a' }) }).state).toBe('notFound');
        const found = identityOf(item(log), { speaker: answer('confirmed') });
        expect(found.state).toBe('found');
        expect(found.state === 'found' && found.byPick).toBe(true);
    });

    it('AnExactMatch_WinsOverAnyPick', () => {
        const log = logWith('Karate');
        const found = identityOf(item(log), { speaker: answer('confirmed', { catalogProductId: 'p-imidacloprid-17-8-sl' }) });
        expect(found.state === 'found' && found.product.id).toBe(KARATE);
        expect(found.state === 'found' && found.byPick).toBeUndefined();
    });

    it('TheCheckIsHeardBeforeHisOwnWord_AChecksNoUnpicks', () => {
        expect(pickedProductOf({ speaker: answer('confirmed'), check: answer('rejected', { isCheck: true }) })).toBeNull();
        expect(pickedProductOf({ speaker: answer('rejected'), check: answer('confirmed', { isCheck: true }) })?.id).toBe(KARATE);
    });

    it('AProductIdTheLibraryDoesNotHold_IsNoPick', () => {
        expect(pickedProductOf({ speaker: answer('confirmed', { catalogProductId: 'p-not-in-the-library' }) })).toBeNull();
    });
});

describe('the product row (lane FACTS-2)', () => {
    const row = (log: DailyLog) => render(<ProductRow item={productBoxesOf(log)[0].items[0]} logId={log.id} kit={kitFor(log)} onOpen={vi.fn()} />);

    it('NamesExist_TheRowSaysSo_InsteadOfCouldNotIdentify', () => {
        row(logWith('Karatay'));
        expect(screen.getByTestId('vr-prow-status').textContent).toBe('जवळची नावं सापडली — दाबून निवडा');
    });

    it('NothingSoundsLike_TheRowKeepsItsOldWords', () => {
        row(logWith('कोणतंतरी औषध'));
        expect(screen.getByTestId('vr-prow-status').textContent).toBe('हे औषध ओळखता आलं नाही');
    });

    it('AfterHisTap_TheRowShowsTheIngredient_AndSaysHeChoseIt_NotThatHeSaidYes', () => {
        row(logWith('Karatay', [answer('confirmed')]));
        expect(screen.getByTestId('vr-prow-ingredient').textContent).toContain('लॅम्बडा');
        const status = screen.getByTestId('vr-prow-status');
        expect(status.getAttribute('data-status')).toBe('said');
        expect(status.textContent).toBe('सुनीलने हे नाव निवडलं');
        expect(status.textContent).not.toMatch(/सांगितलं|हो, हेच/);
    });

    it('AnExactMatchWithAYes_KeepsTheOldRowWords', () => {
        row(logWith('Karate', [answer('confirmed')]));
        expect(screen.getByTestId('vr-prow-status').textContent).toBe('सुनील: हो, हेच');
    });
});
