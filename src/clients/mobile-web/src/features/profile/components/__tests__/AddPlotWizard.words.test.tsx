// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 10; founder 2026-11-21) - the add-plot wizard's steps 1 and 2:
 * labels 16 px in #44403c (stone-700); Marathi placeholders, errors and units in Marathi mode (English mode keeps its English); the toggle says
 * "बियाणं" and "रोपं" once; the variety chips are 48 px high in the one dark chosen look and the last one is "अन्य"; the name placeholder may show
 * the next plot name in his own pattern. Step 3 (the date question) is not touched.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const lang = vi.hoisted(() => ({ current: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../i18n/translations');
    return {
        useLanguage: () => ({ language: lang.current, setLanguage: () => undefined, t: (k: string) => t(k, lang.current) }),
        LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    };
});

import AddPlotWizard from '../AddPlotWizard';
import { nextPlotName } from '../addPlotWords';
import type { CropProfile, FarmerProfile, Plot } from '../../../../types';

const existing = (...names: string[]): Plot[] => names.map((name, i) => ({ id: `p${i + 1}`, name, baseline: { totalArea: 1, unit: 'Acre' } }) as unknown as Plot);
const grapes = (...plotNames: string[]): CropProfile => ({
    id: 'c1', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500', plots: existing(...plotNames), activeScheduleId: null, supportedTasks: [], workflow: [],
} as CropProfile);
const profile = { name: 'T', village: '', phone: '', language: 'mr', operators: [], activeOperatorId: '', waterResources: [], motors: [], machineries: [] } as unknown as FarmerProfile;

const renderWizard = (crop: CropProfile = grapes()) => render(<AddPlotWizard crop={crop} profile={profile} onSave={vi.fn()} onCancel={vi.fn()} />);
const nameInput = () => screen.getAllByRole('textbox')[0] as HTMLInputElement;
const next = () => fireEvent.click(screen.getByRole('button', { name: /पुढची पायरी|Next Step/ }));
const labels = () => Array.from(document.querySelectorAll('label'));
/** Step 1 filled with a name and an area, then "next". */
const toStepTwo = () => {
    fireEvent.change(nameInput(), { target: { value: 'G16' } });
    fireEvent.change(screen.getByTestId('plot-area'), { target: { value: '2' } });
    next();
};

beforeEach(() => { lang.current = 'mr'; });
afterEach(cleanup);

describe('labels: 16 px in #44403c (stone-700), not 12 px light grey', () => {
    it('every label of step 1 and of step 2', () => {
        renderWizard();
        expect(labels().length).toBeGreaterThanOrEqual(4);
        for (const l of labels()) {
            expect(l.className).toContain('text-[16px]');
            expect(l.className).toContain('text-stone-700');
            expect(l.className).not.toContain('text-xs');
            expect(l.className).not.toContain('text-slate-400');
        }
        toStepTwo();
        expect(screen.getByText(/तुम्ही काय लावलं/)).toBeInTheDocument();
        expect(labels().length).toBeGreaterThanOrEqual(3);
        for (const l of labels()) {
            expect(l.className).toContain('text-[16px]');
            expect(l.className).toContain('text-stone-700');
        }
    });

    it('step 3 is not touched: its own label keeps its old look', () => {
        renderWizard();
        toStepTwo();
        fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'महाबीज' } });
        fireEvent.change(document.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: '3' } });
        next();
        expect(screen.getByTestId('plot-start-today')).toBeInTheDocument();
        const tools = labels().find(l => l.textContent?.includes('साधने'));
        expect(tools?.className).toContain('text-xs');
        expect(tools?.className).toContain('text-slate-400');
    });
});

describe('Marathi mode: Marathi placeholders, errors, hint and units', () => {
    it('step 1: the name placeholder is Marathi, the hint under the variety is Marathi, no English left on the step', () => {
        renderWizard();
        expect(nameInput()).toHaveAttribute('placeholder', 'उदा. G16');
        const text = document.body.textContent ?? '';
        expect(text).toContain('किंवा पुढच्या पायरीत बियाणं / रोपवाटिकेचं नाव लिहा');
        for (const english of ['Riverside', 'Or provide', 'is required', 'Enter the area', 'Enter variety']) expect(text).not.toContain(english);
    });

    it('step 1 errors: "प्लॉटचं नाव लिहा" and "क्षेत्र लिहा" (no English beside it)', () => {
        renderWizard();
        fireEvent.change(nameInput(), { target: { value: '   ' } }); // spaces only: the button is on, the name is still missing
        next();
        expect(screen.getByText('प्लॉटचं नाव लिहा')).toBeInTheDocument();
        expect(screen.getByTestId('plot-area-error')).toHaveTextContent(/^\s*क्षेत्र लिहा\s*$/);
        expect(document.body.textContent).not.toContain('Plot name is required');
        expect(document.body.textContent).not.toContain('Enter the area');
    });

    it('step 2: the toggle says "बियाणं" and "रोपं" once each, the units are "किलो / ग्रॅम / पाकीट", the placeholders are Marathi', () => {
        renderWizard();
        toStepTwo();
        const toggles = screen.getAllByRole('button').filter(b => /बियाणं|रोपं/.test(b.textContent ?? ''));
        expect(toggles.map(b => b.textContent?.trim())).toEqual(['बियाणं', 'रोपं']);
        expect(document.body.textContent).not.toContain('(बियाणं)');
        expect(document.body.textContent).not.toContain('(रोप)');
        const select = screen.getByRole('combobox', { name: '' }) as HTMLSelectElement;
        expect(Array.from(select.options).map(o => [o.value, o.textContent])).toEqual([['kg', 'किलो'], ['gm', 'ग्रॅम'], ['Packets', 'पाकीट']]);
        expect(screen.getAllByRole('textbox')[0]).toHaveAttribute('placeholder', 'उदा. महाबीज');
        fireEvent.click(toggles[1]);
        expect(screen.getAllByRole('textbox')[0]).toHaveAttribute('placeholder', 'उदा. नाशिक रोपवाटिका');
        expect(document.querySelector('input[type="number"]')).toHaveAttribute('placeholder', 'रोप किती दिवसांचं होतं');
    });

    it('step 2 errors are Marathi: the variety-or-seed line, the quantity, the plant age', () => {
        renderWizard();
        toStepTwo();
        next();
        expect(screen.getByText('वाणाचं नाव किंवा बियाणं / रोपवाटिकेचं नाव लिहा')).toBeInTheDocument();
        expect(screen.getByText('बियाण्याचं प्रमाण लिहा')).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole('button').filter(b => b.textContent?.trim() === 'रोपं')[0]);
        next();
        expect(screen.getByText('रोपाचं वय लिहा')).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/required|Enter Variety/);
    });
});

describe('English mode keeps its English', () => {
    beforeEach(() => { lang.current = 'en'; });

    it('step 1: the placeholder, the hint and the errors are the English they always were', () => {
        renderWizard();
        expect(nameInput()).toHaveAttribute('placeholder', 'e.g. Riverside Plot');
        expect(document.body.textContent).toContain('Or provide seed/nursery name in next step');
        fireEvent.change(nameInput(), { target: { value: '  ' } });
        next();
        expect(screen.getByText('Plot name is required')).toBeInTheDocument();
        expect(screen.getByTestId('plot-area-error')).toHaveTextContent('Enter the area');
    });

    it('step 2: "Seeds" / "Saplings", "kg / gm / Pkt" and the English placeholders and errors; the chips say "Other"', () => {
        renderWizard();
        expect(screen.getByTestId('variety-chip-Other')).toHaveTextContent('Other');
        toStepTwo();
        const toggles = screen.getAllByRole('button').filter(b => /Seeds|Saplings/.test(b.textContent ?? ''));
        expect(toggles.map(b => b.textContent?.trim())).toEqual(['Seeds', 'Saplings']);
        const select = screen.getByRole('combobox', { name: '' }) as HTMLSelectElement;
        expect(Array.from(select.options).map(o => o.textContent)).toEqual(['kg', 'gm', 'Pkt']);
        expect(screen.getAllByRole('textbox')[0]).toHaveAttribute('placeholder', 'e.g. Mahabeej');
        next();
        expect(screen.getByText('Seed quantity is required')).toBeInTheDocument();
        expect(screen.getByText('Enter Variety name or Seed/Nursery name (at least one required)')).toBeInTheDocument();
    });
});

describe('the variety chips: 48 px, one dark chosen look, "अन्य"', () => {
    it('every chip is at least 48 px high; the chosen one is dark green with white letters and a white tick; the others are white with no tick', () => {
        renderWizard();
        const chips = Array.from(document.querySelectorAll('[data-testid^="variety-chip-"]')) as HTMLElement[];
        expect(chips.length).toBeGreaterThanOrEqual(5);
        for (const c of chips) expect(c.className).toContain('min-h-[48px]');
        fireEvent.click(screen.getByTestId('variety-chip-Super Sonaka'));
        const on = screen.getByTestId('variety-chip-Super Sonaka');
        expect(on).toHaveAttribute('aria-pressed', 'true');
        expect(on.className).toContain('bg-emerald-800');
        expect(on.className).toContain('text-white');
        expect(on.querySelector('[data-part="tick"]')).toBeTruthy();
        const off = screen.getByTestId('variety-chip-Sharad Seedless');
        expect(off).toHaveAttribute('aria-pressed', 'false');
        expect(off.className).toContain('bg-white');
        expect(off.querySelector('[data-part="tick"]')).toBeNull();
        // one tap picks another; only one is chosen
        fireEvent.click(off);
        expect(screen.getByTestId('variety-chip-Super Sonaka')).toHaveAttribute('aria-pressed', 'false');
        expect(chips.filter(c => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    });

    it('the last chip reads "अन्य" in Marathi mode, in the same 48 px look', () => {
        renderWizard();
        const other = screen.getByTestId('variety-chip-Other');
        expect(other).toHaveTextContent('अन्य');
        expect(other.textContent).not.toContain('Other');
        expect(other.className).toContain('min-h-[48px]');
        const all = Array.from(document.querySelectorAll('[data-testid^="variety-chip-"]'));
        expect(all[all.length - 1]).toBe(other);
    });

    it('a crop with no catalogue list gets the plain chips, still 48 px, and the variety he picked is what is saved on step 1', () => {
        renderWizard({ ...grapes(), name: 'Mango' } as CropProfile);
        for (const id of ['Local', 'Hybrid', 'Other']) expect(screen.getByTestId(`variety-chip-${id}`).className).toContain('min-h-[48px]');
        fireEvent.click(screen.getByTestId('variety-chip-Hybrid'));
        expect(screen.getByTestId('variety-chip-Hybrid')).toHaveAttribute('aria-pressed', 'true');
    });
});

describe('the name placeholder shows the next plot name in his own pattern (optional)', () => {
    it('G14, G15 -> "उदा. G16" (a grey placeholder, never filled in)', () => {
        renderWizard(grapes('G14', 'G15'));
        expect(nameInput()).toHaveAttribute('placeholder', 'उदा. G16');
        expect(nameInput().value).toBe('');
    });

    it('his own names lead: "ऊस १", "ऊस २" -> "उदा. ऊस ३"; "Plot 9" -> "उदा. Plot 10"', () => {
        const { unmount } = renderWizard(grapes('ऊस १', 'ऊस २'));
        expect(nameInput()).toHaveAttribute('placeholder', 'उदा. ऊस ३');
        unmount();
        renderWizard(grapes('Plot 9'));
        expect(nameInput()).toHaveAttribute('placeholder', 'उदा. Plot 10');
    });

    it('names that do not end in a number give no pattern: the plain example, never an invented one', () => {
        renderWizard(grapes('वरचा बाग', 'नदीकाठ'));
        expect(nameInput()).toHaveAttribute('placeholder', 'उदा. G16');
    });

    it('English mode shows it as "e.g. G16"', () => {
        lang.current = 'en';
        renderWizard(grapes('G14', 'G15'));
        expect(nameInput()).toHaveAttribute('placeholder', 'e.g. G16');
    });
});

describe('nextPlotName (pure)', () => {
    it('the highest number of his own text plus one, in his own digits and width', () => {
        expect(nextPlotName(['G1', 'G2', 'G15'])).toBe('G16');
        expect(nextPlotName(['G15', 'G3'])).toBe('G16'); // the highest, not the last typed
        expect(nextPlotName(['ऊस २'])).toBe('ऊस ३'); // Devanagari digits stay Devanagari
        expect(nextPlotName(['G09'])).toBe('G10'); // a zero-padded counter keeps its width
        expect(nextPlotName(['A-7'])).toBe('A-8');
        expect(nextPlotName(['U3', 'G15', 'U1'])).toBe('U4'); // the text of the last numbered name leads
        expect(nextPlotName(['g2', 'G3'])).toBe('G4'); // the same text, any case
    });

    it('no number at the end, no names, or a number too long to be a counter: no pattern, no guess', () => {
        expect(nextPlotName([])).toBeNull();
        expect(nextPlotName(['वरचा बाग', 'G15 नदी'])).toBeNull();
        expect(nextPlotName(['गट 1234567'])).toBeNull();
        expect(nextPlotName(['  '])).toBeNull();
    });

    it('a later name without a number does not hide the pattern the earlier ones show', () => {
        expect(nextPlotName(['G14', 'G15', 'माझा बाग'])).toBe('G16');
    });
});

describe('the step counter in the header (CTO finding 2026-11-21): Marathi digits in Marathi mode', () => {
    it('Marathi mode reads "पायरी १/३", then "पायरी २/३" - never Latin digits', () => {
        renderWizard();
        expect(screen.getByText(/पायरी\s*१\/३/)).toBeInTheDocument();
        expect(screen.queryByText(/पायरी\s*1\/3/)).toBeNull();
        toStepTwo();
        expect(screen.getByText(/पायरी\s*२\/३/)).toBeInTheDocument();
        expect(screen.queryByText(/पायरी\s*2\/3/)).toBeNull();
    });

    it('English mode keeps "Step 1/3" with 0-9', () => {
        lang.current = 'en';
        renderWizard();
        expect(screen.getByText(/Step\s*1\/3/i)).toBeInTheDocument();
    });
});
