// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 2; founder 2026-11-06, doctrine P4) - the product card's
 * sourced lines. A benefit line shows only once a person has ticked it (`checkedBy`) AND he said "हो, हेच", and always carries the
 * "इंटरनेटवरून" mark. A purchase bill's amount shows only to a member who may see money (MU-3).
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import referenceCatalog from '../../../../../../../../../sync-contract/reference/inputs/catalog.json';
import { setStoredLibrary, type CatalogFile } from '../../../../../domain/inputs/inputCatalog';
import type { DailyLog, InputIdentityAnswer } from '../../../../../domain/types/log.types';
import { productBoxesOf } from '../productModel';
import ProductCard, { type ProductAnswerKit } from '../ProductCard';
import { resultCopy } from '../resultCopy';

const LOG = 'c3c3c3c3-0000-4000-8000-000000000003';
const CONFIDOR = 'p-imidacloprid-17-8-sl';

const benefit = (checkedBy: string | null) => ({
    crop: 'grape', mr: 'द्राक्षावरचा रस शोषणारे किडे आटोक्यात ठेवायला मदत होते', en: 'Helps keep sap-sucking pests in check on grapes',
    url: 'https://example.invalid/label', retrievedOn: '2026-11-08', checkedBy,
});
/** The shared library with a benefit line on Confidor (one ticked, one not). */
const libraryWith = (lines: ReturnType<typeof benefit>[]): CatalogFile => {
    const lib = structuredClone(referenceCatalog) as unknown as CatalogFile;
    lib.version = 'inputs-test';
    lib.products.find(p => p.id === CONFIDOR)!.benefits = lines;
    return lib;
};

const answer = (verdict: InputIdentityAnswer['verdict'], isCheck = false): InputIdentityAnswer => ({
    assertionId: 'as-1', inputEventId: 'ev-1', mixIndex: 0, verdict, catalogProductId: CONFIDOR, catalogVersion: 'inputs-test',
    assertedByUserId: 'user-1', assertedAtUtc: '2026-11-09T05:00:00.000Z', isCheck,
});

const logWith = (answers: InputIdentityAnswer[]): DailyLog => ({
    id: LOG, date: '2026-11-09', cropActivities: [], irrigation: [], labour: [], machinery: [],
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['p1'], selectedPlotNames: ['प्लॉट १'] }] },
    inputs: [{ id: 'ev-1', method: 'Spray', mix: [{ id: 'm1', productName: 'कॉन्फिडॉर', dose: 1, unit: 'ml' }] }],
    inputIdentities: answers,
}) as unknown as DailyLog;

const kitFor = (log: DailyLog, over: Partial<ProductAnswerKit> = {}): ProductAnswerKit => ({
    logById: new Map([[log.id, log]]),
    canCheck: true,
    canSeeMoney: false,
    nameOfUser: id => (id === 'user-1' ? 'सुनील' : 'अज्ञात'),
    cropNamesOf: () => ['Grapes'],
    onAnswer: vi.fn(async () => undefined),
    onPhoto: vi.fn(async () => undefined),
    ...over,
});

const showCard = (log: DailyLog, kit: ProductAnswerKit) => {
    const item = productBoxesOf(log)[0].items[0];
    return render(<ProductCard item={item} logId={log.id} kit={kit} onClose={vi.fn()} />);
};

afterEach(() => { cleanup(); setStoredLibrary(null); });

describe('the benefit line (lane IT4 Task 2)', () => {
    it('BenefitLine_OnlyWhenCheckedBy_AndMarkedFromWeb', () => {
        // A ticked line, but he has not said "हो" yet: nothing shown.
        expect(setStoredLibrary(libraryWith([benefit('founder')]))).toBe(true);
        let log = logWith([]);
        showCard(log, kitFor(log));
        expect(screen.queryByTestId('vr-fact-benefit')).toBeNull();
        cleanup();

        // He said "हो, हेच", but nobody has ticked the line: still nothing (P4: nothing invented).
        expect(setStoredLibrary(libraryWith([benefit(null)]))).toBe(true);
        log = logWith([answer('confirmed')]);
        showCard(log, kitFor(log));
        expect(screen.queryByTestId('vr-fact-benefit')).toBeNull();
        cleanup();

        // Ticked AND he said "हो, हेच": shown, marked "इंटरनेटवरून".
        expect(setStoredLibrary(libraryWith([benefit(null), benefit('founder')]))).toBe(true);
        log = logWith([answer('confirmed')]);
        showCard(log, kitFor(log));
        const line = screen.getByTestId('vr-fact-benefit');
        expect(line.textContent).toContain('द्राक्षावरचा रस शोषणारे किडे आटोक्यात ठेवायला मदत होते');
        expect(screen.getByTestId('vr-benefit-web').textContent).toBe('इंटरनेटवरून');
        expect(line.textContent).not.toMatch(/\d/); // the authored lines hold no number
        cleanup();

        // A "नाही" is not a "हो".
        log = logWith([answer('rejected')]);
        showCard(log, kitFor(log));
        expect(screen.queryByTestId('vr-fact-benefit')).toBeNull();
    });
});

describe('the bill line (lane IT4 Task 2)', () => {
    const bill = { date: '3 नोव्हें.', amount: 540 };

    it('BillAmount_HiddenWithoutMoneyAccess', () => {
        const log = logWith([]);
        showCard(log, kitFor(log, { canSeeMoney: false, billOf: () => bill }));
        const line = screen.getByTestId('vr-fact-bill');
        expect(line.textContent).toContain('खरेदी बिलाशी जुळलं');
        expect(line.textContent).toContain('3 नोव्हें.');
        expect(line.textContent).not.toMatch(/540|५४०|₹/); // no rupee amount for someone who may not see money
        cleanup();

        showCard(log, kitFor(log, { canSeeMoney: true, billOf: () => bill }));
        expect(screen.getByTestId('vr-fact-bill').textContent).toContain('₹५४०');
        cleanup();

        // No matched bill: no bill line at all.
        showCard(log, kitFor(log, { canSeeMoney: true }));
        expect(screen.queryByTestId('vr-fact-bill')).toBeNull();
    });
});

describe('the card labels (lane IT-W1, founder wording 2026-11-09)', () => {
    it('CardLabels_AreTheFounderWords_InMarathi_AndTheProposedEnglishTwins', () => {
        const mr = resultCopy('mr');
        expect(mr.factIngredient).toBe('घटक आणि मूलद्रव्य');
        expect(mr.factBenefit).toBe('कशासाठी वापरायचं');
        expect(mr.factCompany).toBe('कंपनी');
        expect(mr.factBill).toBe('बिल');
        // Marathi mode shows Marathi only: no Latin letters in any of the four labels.
        for (const label of [mr.factIngredient, mr.factBenefit, mr.factCompany, mr.factBill]) expect(label).not.toMatch(/[A-Za-z]/);
        const en = resultCopy('en');
        expect(en.factIngredient).toBe('Ingredients and nutrients'); // PROPOSED (English)
        expect(en.factBenefit).toBe('What it is used for'); // PROPOSED (English)
        for (const label of [en.factIngredient, en.factBenefit]) expect(label).not.toMatch(/[ऀ-ॿ]/);
    });

    it('CardLabels_AreWhatTheCardDraws', () => {
        expect(setStoredLibrary(libraryWith([benefit('founder')]))).toBe(true);
        const log = logWith([answer('confirmed')]);
        showCard(log, kitFor(log));
        expect(screen.getByTestId('vr-fact-benefit').textContent).toContain('कशासाठी वापरायचं');
        expect(screen.getByTestId('vr-fact-ingredient').textContent).toContain('घटक आणि मूलद्रव्य');
        expect(screen.getByTestId('vr-fact-benefit').textContent).not.toContain('फायदा');
    });
});
