// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 2 (review N-7).
//
// The service-proof page speaks his language only — Marathi or English, never both — and a refusal is said as
// ShramSafal's rule. It used to be an English page with a Marathi title, and its refusal an English sentence.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ language: 'mr' as string, role: 'PrimaryOwner' as string, answer: { kind: 'refused' } as unknown }));
vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: h.language }) }));
vi.mock('../../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarm: { farmId: 'farm-1', role: h.role } }),
}));
vi.mock('../../data/serviceProofClient', () => ({ generateServiceProof: vi.fn(async () => h.answer) }));

import { generateServiceProof } from '../../data/serviceProofClient';
import ServiceProofPage from '../ServiceProofPage';

const LATIN_WORD = /[A-Za-z]{2,}/;
const DEVANAGARI = /[ऀ-ॿ]/;

beforeEach(() => {
    h.language = 'mr';
    h.role = 'PrimaryOwner';
    h.answer = { kind: 'refused' };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ServiceProofPage — one language at a time', () => {
    it('Marathi: Marathi only, and the refusal is ShramSafal\'s rule', async () => {
        render(<ServiceProofPage onBack={vi.fn()} />);
        expect(screen.getByTestId('service-proof-title')).toHaveTextContent('सेवेचा पुरावा');
        expect(screen.getByTestId('service-proof-make')).toHaveTextContent('अहवाल तयार करा');

        fireEvent.click(screen.getByTestId('service-proof-make'));
        expect(await screen.findByTestId('service-proof-error'))
            .toHaveTextContent('श्रमसफलच्या नियमानुसार हा अहवाल फक्त शेताचा खर्च आणि नोंदी पाहणाऱ्यांनाच मिळतो.');
        expect(generateServiceProof).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-1' }));
        expect(screen.getByTestId('service-proof-page').textContent ?? '').not.toMatch(LATIN_WORD);

        fireEvent.click(screen.getByTestId('service-proof-change-period'));
        expect(screen.getByTestId('service-proof-sheet-title')).toHaveTextContent('कालावधी निवडा');
        expect(document.body.textContent ?? '').not.toMatch(LATIN_WORD);
    });

    it('English: English only', async () => {
        h.language = 'en';
        render(<ServiceProofPage onBack={vi.fn()} />);
        expect(screen.getByTestId('service-proof-title')).toHaveTextContent('Service proof');
        fireEvent.click(screen.getByTestId('service-proof-make'));
        expect(await screen.findByTestId('service-proof-error'))
            .toHaveTextContent("By ShramSafal's rules this report goes only to those who see the farm's money and records.");
        fireEvent.click(screen.getByTestId('service-proof-change-period'));
        expect(document.body.textContent ?? '').not.toMatch(DEVANAGARI);
    });

    it('a seat the page is not for is told so in his language only', () => {
        h.role = 'Worker';
        render(<ServiceProofPage />);
        expect(screen.getByTestId('service-proof-not-for-seat'))
            .toHaveTextContent('ही सुविधा फक्त कृषितज्ज्ञ, सल्लागार आणि मुख्य मालकांसाठी आहे.');
        expect(document.body.textContent ?? '').not.toMatch(LATIN_WORD);
    });
});
