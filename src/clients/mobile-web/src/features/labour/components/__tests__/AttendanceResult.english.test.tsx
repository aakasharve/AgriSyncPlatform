// @vitest-environment jsdom
/**
 * Repair FIX-1 round 1, Bug 5 (screen 4 of 4): English mode is English only on the हजेरी confirm card — no Devanagari
 * anywhere it draws (text, placeholders, spoken labels), the one exception being names people typed or the server sent.
 * Marathi mode keeps the founder's words exactly ("बरोबर", "बदल करा", the pre-save line).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AttendanceResult from '../AttendanceResult';
import type { AgriLogResponse } from '../../../../types';

const h = vi.hoisted(() => ({ language: 'en' as 'mr' | 'en', fetchOperators: vi.fn(async (): Promise<unknown[]> => []) }));
vi.mock('../../../../application/usecases/sync/MarkAttendanceCommand', () => ({ MarkAttendanceCommand: { enqueue: vi.fn(async () => 'id') } }));
vi.mock('../../data/fieldOperatorClient', () => ({ fetchFieldOperators: () => h.fetchOperators(), createFieldOperator: vi.fn() }));
vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: h.language }) }));

const DEVANAGARI = /[ऀ-ॿ]/;
/** Everything the card shows or reads aloud: its text, every placeholder, every spoken label. */
const shownWords = (root: HTMLElement) => [
    root.textContent ?? '',
    ...Array.from(root.querySelectorAll('[placeholder]')).map(el => el.getAttribute('placeholder') ?? ''),
    ...Array.from(root.querySelectorAll('[aria-label]')).map(el => el.getAttribute('aria-label') ?? ''),
].join(' | ');

const FARM = '22222222-2222-2222-2222-222222222222';
const base: AgriLogResponse = {
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [],
    labour: [], inputs: [], machinery: [], activityExpenses: [], missingSegments: [],
};
const line = (over: Record<string, unknown>) => ({ id: 'l1', type: 'hired', ...over }) as unknown as AgriLogResponse['labour'][number];
const ROSTER = [
    { id: 'op-ganesh', displayName: 'Ganesh', isActive: true },
    { id: 'op-balu-1', displayName: 'Balu', fullName: 'Balu Pawar', isActive: true },
    { id: 'op-balu-2', displayName: 'Balu', fullName: 'Balu Jadhav', isActive: true },
];

async function draw(labour: AgriLogResponse['labour'], anchorHeadcount = 3) {
    h.fetchOperators.mockResolvedValueOnce(ROSTER);
    const view = render(<AttendanceResult draft={{ ...base, labour }} anchor={{ state: 'anchored', headcount: anchorHeadcount, logId: 'log-1' }}
        farmId={FARM} onConfirm={vi.fn()} onSpeakMore={vi.fn()} />);
    await waitFor(() => expect(h.fetchOperators).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 0));
    return view.container;
}

beforeEach(() => { h.language = 'en'; h.fetchOperators.mockReset(); });
afterEach(cleanup);

describe('हजेरी confirm card — English mode is English only', () => {
    it('the card, its names, बदल करा and "कोणामार्फत?" — no Devanagari; the save reads "Correct"', async () => {
        const card = await draw([line({ count: 3, workerNames: ['Ganesh', 'Raju', 'Balu'], sourceText: 'Ganesh Raju Balu came' })]);
        expect(screen.getByRole('button', { name: 'Correct' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
        expect(card).toHaveTextContent('Nothing is saved until you press "Correct".');
        expect(shownWords(card)).not.toMatch(DEVANAGARI);

        fireEvent.click(screen.getByRole('button', { name: 'Change' }));
        fireEvent.click(screen.getByRole('button', { name: 'Through whom?' }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose from the list' }));
        expect(shownWords(card)).not.toMatch(DEVANAGARI);
    });

    it('the three questions, a disagreement and a contradiction — English only', async () => {
        for (const labour of [
            [line({ count: 3 })],                                          // who were they?
            [line({ count: 3, workerNames: ['Ganesh'] })],                  // who else?
            [line({ count: 10 })],                                         // 10 said, 3 understood before
            [line({ id: 'a', count: 2, workerNames: ['Ganesh'], shiftId: 'full' }), line({ id: 'b', workerNames: ['Ganesh'], shiftId: 'half' })],
        ]) {
            const card = await draw(labour);
            expect(shownWords(card)).not.toMatch(DEVANAGARI);
            cleanup();
        }
    });

    it('Marathi mode keeps the founder\'s words exactly', async () => {
        h.language = 'mr';
        const card = await draw([line({ count: 3, workerNames: ['गणेश'] })]);
        expect(screen.getByRole('button', { name: 'बरोबर' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'बदल करा' })).toBeInTheDocument();
        expect(card).toHaveTextContent('"बरोबर" दाबेपर्यंत काहीही जतन होणार नाही.');
        expect(card).toHaveTextContent('श्रम सफलला समजलं');
        expect(card).toHaveTextContent('यांच्याशिवाय अजून कोण होते?');
    });
});
