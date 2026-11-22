// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: facts-card-input-truth-2026-11-19 (lane FACTS-1; founder 2026-11-19) - what the product card tells a farmer who said ONE word:
 * what each ingredient does (with its source), the day of the season and the stage, the amount in HIS words or "तुम्ही सांगितलं नाही",
 * and what to know at this stage. Only sourced lines, only after the agronomist's tick (a test build may show them marked). P7: the record is only read.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const lang = { current: 'mr' as 'mr' | 'en' };
    (globalThis as unknown as { __lang: typeof lang }).__lang = lang;
    const ctx = () => ({ language: lang.current, setLanguage: () => undefined, t: (k: string) => t(k, lang.current) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import referenceCatalog from '../../../../../../../../../sync-contract/reference/inputs/catalog.json';
import { setStoredLibrary, type CatalogFile } from '../../../../../domain/inputs/inputCatalog';
import type { UseContext } from '../../../../../domain/inputs/ingredientFacts';
import type { DailyLog } from '../../../../../domain/types/log.types';
import { productBoxesOf } from '../productModel';
import ProductCard, { type ProductAnswerKit } from '../ProductCard';

const LOG = 'f4f4f4f4-0000-4000-8000-000000000004';
const setLang = (l: 'mr' | 'en') => { (globalThis as unknown as { __lang: { current: string } }).__lang.current = l; };

const logWith = (productName: string, dose?: { dose: number; unit: string }): DailyLog => ({
    id: LOG, date: '2026-11-12', cropActivities: [], irrigation: [], labour: [], machinery: [],
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['p1'], selectedPlotNames: ['प्लॉट १'] }] },
    inputs: [{ id: 'ev-1', method: 'Spray', mix: [{ id: 'm1', productName, ...(dose ?? {}) }] }],
}) as unknown as DailyLog;

const ctxOf = (over: Partial<UseContext> = {}): UseContext => ({ dateKey: '2026-11-12', day: 33, refType: 'PRUNING', stageName: 'शेंडा वाढ', nextStage: null, cropName: 'Grapes', ...over });

const kitFor = (log: DailyLog, use: UseContext | null | undefined): ProductAnswerKit => ({
    logById: new Map([[log.id, log]]), canCheck: false, canSeeMoney: false, nameOfUser: () => 'अज्ञात', cropNamesOf: () => ['Grapes'],
    onAnswer: vi.fn(async () => undefined), onPhoto: vi.fn(async () => undefined),
    ...(use === undefined ? {} : { useContextOf: () => use }),
});

const show = (log: DailyLog, kit: ProductAnswerKit) => render(<ProductCard item={productBoxesOf(log)[0].items[0]} logId={log.id} kit={kit} onClose={vi.fn()} />);

/** The shared library plus one test product holding hydrogen cyanamide (the library holds none today). */
const withHcProduct = (): CatalogFile => {
    const lib = structuredClone(referenceCatalog) as unknown as CatalogFile;
    lib.version = 'inputs-test';
    const base = lib.products.find(p => p.id === 'p-lambda-cyhalothrin-5-ec')!;
    lib.products.push({ ...structuredClone(base), id: 'p-test-hc', category: 'pgr', aliases: ['testbreak'], brands: [], activeIngredients: [{ en: 'Hydrogen Cyanamide', mr: 'हायड्रोजन सायनामाईड', pct: '50%' }] } as never);
    return lib;
};

afterEach(() => { cleanup(); setStoredLibrary(null); vi.unstubAllEnvs(); setLang('mr'); });

describe('product card: one word is enough', () => {
    it('OneWord_TestBuild_ShowsWhatTheIngredientDoes_WithItsSource_MarkedNotYetChecked', () => {
        vi.stubEnv('VITE_FACTS_SHOW_UNTICKED', '1');
        const log = logWith('Karate');
        show(log, kitFor(log, ctxOf()));
        const does = screen.getByTestId('vr-does-lambdacyhalothrin');
        expect(does.textContent).toContain('काम:');
        expect(does.querySelector('[data-src="IRAC"]')?.textContent).toContain('इंटरनेटवरून · IRAC');
        expect(within(does).getByTestId('vr-fact-untick').textContent).toBe('तपासणी बाकी');
    });

    it('OneWord_ShippedBuild_UntickedLinesAreNeverShown_ButTheDayAndTheAmountLinesStillAre', () => {
        const log = logWith('Karate');
        show(log, kitFor(log, ctxOf()));
        expect(screen.queryByTestId('vr-card-does')).toBeNull();
        expect(screen.getByTestId('vr-fact-when').textContent).toContain('छाटणीनंतर दिवस ३४');
        expect(screen.getByTestId('vr-fact-stage').textContent).toContain('शेंडा वाढ');
    });

    it('NoAmountSaid_SaysSo_AndNeverInventsOne', () => {
        const log = logWith('Karate');
        show(log, kitFor(log, ctxOf()));
        expect(screen.getByTestId('vr-fact-dose-none').textContent).toContain('तुम्ही सांगितलं नाही');
        expect(screen.queryByTestId('vr-fact-dose')).toBeNull();
    });

    it('AmountSaid_IsShownInHisWordsAndUnits', () => {
        const log = logWith('Karate', { dose: 250, unit: 'ml' });
        show(log, kitFor(log, ctxOf()));
        expect(screen.getByTestId('vr-fact-dose').textContent).toMatch(/२५०|250/);
        expect(screen.queryByTestId('vr-fact-dose-none')).toBeNull();
    });

    it('NoScheduleKnown_TheDayAndStageLinesAreLeftOut', () => {
        const log = logWith('Karate');
        show(log, kitFor(log, ctxOf({ day: null, stageName: null, refType: null })));
        expect(screen.queryByTestId('vr-fact-when')).toBeNull();
        expect(screen.queryByTestId('vr-fact-stage')).toBeNull();
    });

    it('NoUseContextAtAll_OldCallers_StillRender', () => {
        const log = logWith('Karate');
        show(log, kitFor(log, undefined));
        expect(screen.getByTestId('vr-card-name')).toBeTruthy();
        expect(screen.queryByTestId('vr-fact-when')).toBeNull();
    });
});

describe('product card: what to know at this stage', () => {
    it('HydrogenCyanamide_OnDayTwo_SaysTheAdvisedTime_AndThatHisDayFits_InDevanagariDigits', () => {
        vi.stubEnv('VITE_FACTS_SHOW_UNTICKED', '1');
        setStoredLibrary(withHcProduct());
        const log = logWith('testbreak');
        show(log, kitFor(log, ctxOf({ day: 2, stageName: 'छाटणी' })));
        const line = screen.getByTestId('vr-stage-hc-bud-48h');
        expect(line.textContent).toContain('४८ तासांच्या आत');
        expect(line.textContent).toContain('दिवस ३');
        expect(line.textContent).toContain('सल्ल्याच्या वेळेत');
        expect(line.querySelector('[data-src="NHB"]')).toBeTruthy();
    });

    it('NothingAtThisStage_NoStageBoxIsDrawn', () => {
        vi.stubEnv('VITE_FACTS_SHOW_UNTICKED', '1');
        const log = logWith('Karate');
        show(log, kitFor(log, ctxOf()));
        expect(screen.queryByTestId('vr-card-stage-lines')).toBeNull();
    });

    it('English_ShowsEnglishWordsOnly', () => {
        vi.stubEnv('VITE_FACTS_SHOW_UNTICKED', '1');
        setLang('en');
        const log = logWith('Karate');
        show(log, kitFor(log, ctxOf()));
        expect(screen.getByTestId('vr-does-lambdacyhalothrin').textContent).toMatch(/Acts on the pest/);
        expect(screen.getByTestId('vr-fact-when').textContent).toContain('Day 34 after pruning');
        expect(screen.queryByTestId('vr-fact-stage')).toBeNull();
    });
});

describe('product card: a product the library does not hold', () => {
    it('Unknown_GetsNoFactsAndNoDayLine_OnlyThePhotoOption', () => {
        vi.stubEnv('VITE_FACTS_SHOW_UNTICKED', '1');
        const log = logWith('कोणतंतरी औषध');
        show(log, kitFor(log, ctxOf()));
        expect(screen.getByTestId('vr-card-unknown')).toBeTruthy();
        expect(screen.queryByTestId('vr-card-does')).toBeNull();
        expect(screen.queryByTestId('vr-fact-when')).toBeNull();
    });
});
