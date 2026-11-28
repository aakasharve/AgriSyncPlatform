// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, row B4) — after a real answer the product's own row says what it was for,
 * exactly as the server last read it back (the store the question slot fills). Nothing before an answer; a spoken answer's words only
 * for someone who may hear the record; Marathi mode only.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ lang: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: h.lang }) }));

import { SavedProductRow } from '../../voiceFlowV2/SavedProducts';
import { __resetProductPurposeStoreForTests, publishProductPurposes } from '../../../services/productPurposeStore';
import { purposeAnswerText, purposeChips, purposeQuestion, TARGET_NAMES_MR } from '../productPurposeWords';
import type { ProductAnswerKit } from '../../voiceResult/ProductCard';
import type { ProductItem } from '../../voiceResult/productModel';
import type { DailyLog } from '../../../../../types';

const LOG = { id: 'log-1', date: '2026-11-28', inputs: [] } as unknown as DailyLog;
const kit: ProductAnswerKit = {
    logById: new Map([[LOG.id, LOG]]), canCheck: false, canSeeMoney: false,
    nameOfUser: () => 'कोणीतरी', cropNamesOf: () => [], onAnswer: async () => undefined, onPhoto: async () => undefined,
};
const ITEM: ProductItem = { id: 'i-1', label: 'Uthane M-45', matchName: 'Uthane M-45', ref: { eventId: 'ev-1', mixIndex: 0 } };
const answered = (answer: Record<string, unknown>) => [{
    inputEventId: 'ev-1', mixIndex: 0, productName: 'Uthane M-45', catalogProductId: null, statedReason: null, purposeStated: false, ask: false,
    answer: { questionEventId: 'q', answerMode: 'chip', response: null, responseWithheld: false, answerCode: null, answeredByUserId: 'u', answeredAtUtc: null, ...answer },
}];
const row = () => render(<SavedProductRow item={ITEM} logId={LOG.id} kit={kit} onOpen={() => undefined} />);

beforeEach(() => { h.lang = 'mr'; __resetProductPurposeStoreForTests(); });
afterEach(cleanup);

describe('the product row after Sathi\'s question', () => {
    it('says nothing before an answer', () => {
        row();
        expect(screen.queryByTestId('vr-prow-purpose')).toBeNull();
    });

    it('shows the chip he chose as soon as the server read says so', () => {
        row();
        act(() => publishProductPurposes('log-1', answered({ answerCode: 'lateblight', response: 'उशिराचा करपा' })));
        expect(screen.getByTestId('vr-prow-purpose')).toHaveTextContent('कशासाठी: उशिराचा करपा');
    });

    it('a spoken answer: his words in quotes; withheld words are not shown, only that he told it', () => {
        row();
        act(() => publishProductPurposes('log-1', answered({ answerMode: 'voice', response: 'करप्यासाठी मारलं' })));
        expect(screen.getByTestId('vr-prow-purpose')).toHaveTextContent('कशासाठी: “करप्यासाठी मारलं”');
        act(() => publishProductPurposes('log-1', answered({ answerMode: 'voice', response: null, responseWithheld: true })));
        expect(screen.getByTestId('vr-prow-purpose')).toHaveTextContent('कशासाठी: बोलून सांगितलं');
    });

    it('English mode: no Marathi line on the row', () => {
        h.lang = 'en';
        row();
        act(() => publishProductPurposes('log-1', answered({ answerCode: 'lateblight', response: 'उशिराचा करपा' })));
        expect(screen.queryByTestId('vr-prow-purpose')).toBeNull();
    });

    it('another product of the record does not borrow the answer', () => {
        render(<SavedProductRow item={{ ...ITEM, id: 'i-2', ref: { eventId: 'ev-1', mixIndex: 1 } }} logId={LOG.id} kit={kit} onOpen={() => undefined} />);
        act(() => publishProductPurposes('log-1', answered({ answerCode: 'lateblight', response: 'उशिराचा करपा' })));
        expect(screen.queryByTestId('vr-prow-purpose')).toBeNull();
    });
});

describe('the words', () => {
    it('the design\'s question for a fungicide, and its twins', () => {
        expect(purposeQuestion('युथेन एम-45', 'fungicide')).toBe('युथेन एम-45 कोणत्या रोगासाठी मारलं?');
        expect(purposeQuestion('कॉन्फिडॉर', 'insecticide')).toBe('कॉन्फिडॉर कोणत्या किडीसाठी मारलं?');
        expect(purposeQuestion('खत', undefined)).toBe('खत कशासाठी दिलं?');
    });

    it('chips: only named pests, diseases and weeds, each name once, at most six, then "माहीत नाही"', () => {
        expect(purposeChips(['flowering', 'jassids', 'hopper', 'thrips']).map(c => c.label)).toEqual(['तुडतुडे', 'फुलकिडे', 'माहीत नाही']);
        expect(purposeChips(undefined)).toEqual([{ code: 'unknown', label: 'माहीत नाही' }]);
        expect(purposeChips(Object.keys(TARGET_NAMES_MR)).length).toBe(7);
        for (const label of Object.values(TARGET_NAMES_MR)) expect(label).not.toMatch(/[A-Za-z]|\p{Extended_Pictographic}/u);
    });

    it('"माहीत नाही" reads as itself; a chip without its words falls back to the table', () => {
        expect(purposeAnswerText({ answerMode: 'chip', response: null, responseWithheld: false, answerCode: 'unknown' })).toBe('माहीत नाही');
        expect(purposeAnswerText({ answerMode: 'chip', response: null, responseWithheld: false, answerCode: 'powdery' })).toBe('भुरी');
    });
});
