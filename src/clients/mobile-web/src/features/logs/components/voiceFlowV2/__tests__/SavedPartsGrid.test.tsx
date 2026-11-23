// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 9) — the saved screen's eight parts: each told part with what he said (as recorded,
 * Marathi digits in Marathi mode), a part the server could not find in his words in amber (not a button: saying it again
 * would record it twice), and each untold part a red "सांगितलं नाही" button that opens the ONE mic for that part.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const { lng } = vi.hoisted(() => ({ lng: { v: 'mr' as 'mr' | 'en' } }));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: lng.v, setLanguage: () => undefined, t: (k: string) => t(k, lng.v) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import type { DailyLog } from '../../../../../types';
import { buildDayView, PARTS, type WhoDeps } from '../../voiceResult/resultModel';
import SavedPartsGrid from '../SavedPartsGrid';

const said = 'आज दहा मजूर आले, दोन तास पाणी दिलं, छाटणी केली';
const log = (over: Record<string, unknown> = {}): DailyLog => ({
    id: 'L1', date: '2026-10-26', dayOutcome: 'WORK_RECORDED', fullTranscript: said,
    context: { selection: [{ cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: ['p1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [{ id: 'a1', title: 'छाटणी', sourceText: 'छाटणी केली' }],
    irrigation: [{ id: 'irr1', durationHours: 2, sourceText: 'दोन तास पाणी' }],
    labour: [{ id: 'lab1', count: 10, sourceText: 'दहा मजूर' }],
    // the server could NOT find this phrase in his words: mentioned, but not told
    activityExpenses: [{ id: 'e1', reason: 'डिझेल', totalAmount: 600, sourceText: 'डिझेलला सहाशे', provenanceVerified: false }],
    inputs: [], machinery: [],
    meta: { createdAtISO: '2026-10-26T04:00:00.000Z', createdByOperatorId: 'op-me' },
    ...over,
}) as unknown as DailyLog;

const dayOf = (language: 'mr' | 'en') => {
    const deps: WhoDeps = { youIds: new Set(['op-me']), nameOf: () => undefined, ownName: 'सुनील', unknownLabel: 'अज्ञात', language, nativeDigits: true };
    const l = log();
    return buildDayView([l], [l], deps);
};

afterEach(() => { cleanup(); lng.v = 'mr'; });

describe('SavedPartsGrid — the eight parts with his values', () => {
    it('draws all eight parts, in the parts\' order', () => {
        render(<SavedPartsGrid day={dayOf('mr')} onTellMore={vi.fn()} />);
        const tiles = [...screen.getByTestId('vr2-parts').querySelectorAll('[data-told]')];
        expect(tiles.map(t => t.getAttribute('data-testid'))).toEqual(PARTS.map(p => `vr2-part-${p.key}`));
    });

    it('a told part shows what he said, in Marathi digits', () => {
        render(<SavedPartsGrid day={dayOf('mr')} onTellMore={vi.fn()} />);
        const labour = screen.getByTestId('vr2-part-labour');
        expect(labour.getAttribute('data-told')).toBe('yes');
        expect(labour.textContent).toContain('मजूर');
        expect(labour.textContent).toContain('१० जण');
        expect(labour.textContent).not.toMatch(/[0-9]/);
        expect(screen.getByTestId('vr2-part-irrigation').textContent).toContain('२ तास');
        expect(labour.tagName).not.toBe('BUTTON');
    });

    it('an untold part is a red "सांगितलं नाही" button that opens the mic for THAT part', () => {
        const onTellMore = vi.fn();
        render(<SavedPartsGrid day={dayOf('mr')} onTellMore={onTellMore} />);
        const machinery = screen.getByTestId('vr2-part-machinery');
        expect(machinery.tagName).toBe('BUTTON');
        expect(machinery.getAttribute('data-told')).toBe('no');
        expect(machinery.textContent).toContain('सांगितलं नाही');
        expect(machinery.className).toContain('red');
        fireEvent.click(machinery);
        expect(onTellMore).toHaveBeenCalledWith('machinery');
        expect(onTellMore).toHaveBeenCalledTimes(1);
    });

    it('a part the server could not find in his words is amber "नक्की समजलं नाही", not a button', () => {
        const onTellMore = vi.fn();
        render(<SavedPartsGrid day={dayOf('mr')} onTellMore={onTellMore} />);
        const expense = screen.getByTestId('vr2-part-expense');
        expect(expense.getAttribute('data-told')).toBe('unsure');
        expect(expense.tagName).not.toBe('BUTTON');
        expect(expense.textContent).toContain('नक्की समजलं नाही');
        expect(expense.textContent).not.toContain('सांगितलं नाही');
        fireEvent.click(expense);
        expect(onTellMore).not.toHaveBeenCalled();
    });

    it('the header counts only its own tiles that are filled (no score, no projection)', () => {
        render(<SavedPartsGrid day={dayOf('mr')} onTellMore={vi.fn()} />);
        const head = screen.getByTestId('vr2-parts-count');
        // crop, labour, irrigation are told: ३ of ८
        expect(head.textContent).toBe('८ पैकी ३ भरले');
        expect(within(screen.getByTestId('vr2-parts')).queryByText(/\/१०|\/10/)).toBeNull();
    });

    it('English mode: English part names and words, no Devanagari', () => {
        lng.v = 'en';
        render(<SavedPartsGrid day={dayOf('en')} onTellMore={vi.fn()} />);
        expect(screen.getByTestId('vr2-part-labour').textContent).toContain('Labour');
        expect(screen.getByTestId('vr2-part-machinery').textContent).toContain('Not told');
        expect(screen.getByTestId('vr2-part-machinery').textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});
