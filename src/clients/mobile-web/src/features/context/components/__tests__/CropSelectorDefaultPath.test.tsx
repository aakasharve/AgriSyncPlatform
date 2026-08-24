// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop — FINDING F5.
 *
 * THE DEFECT THIS FILE EXISTS TO CATCH. The founder directed the vivid crop
 * selection (Task 16, Problem 2) and approved it ON THE LOG SCREEN. It
 * shipped ungated, so `Attendance.tsx` — the only other consumer of this
 * component, a screen he never looked at — silently got it too, against spec
 * §5.1 ("CropSelector is not to be redesigned"). The existing regression
 * guard was `expect(screen.getByText('Entire Farm')).toBeInTheDocument()`,
 * which is exactly why the leak went unnoticed: a card can be restyled from
 * top to bottom and still contain that string.
 *
 * So every assertion here is about RENDERED OUTPUT on the DEFAULT path — the
 * actual classes and sizes `Attendance.tsx` gets — pinned against what `main`
 * rendered before this branch, both positively (the old treatment is still
 * there) and negatively (the new treatment is not).
 *
 * NOTHING IS MOCKED IN THIS FILE, DELIBERATELY. `CropSelector.test.tsx`
 * mocks `i18n/LanguageContext`, so it cannot detect a hard provider
 * dependency — a mocked `useLanguage` never throws. This file renders the
 * real component with the real i18n module and NO `LanguageProvider` around
 * it, which is the second half of F5: `useLanguage()` throws outside the
 * provider (`LanguageContext.tsx`), and adding that call gave every existing
 * consumer a provider dependency none of them previously had.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import type { CropProfile } from '../../../../types';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';
import CropSelector from '../CropSelector';

afterEach(() => {
    cleanup();
});

/** `color: 'bg-purple-500'` resolves to the purple theme in
 * `shared/utils/colorTheme.ts`: `slideBgSelected: 'bg-purple-50'` (what main
 * used on a selected card), `strongFill: 'bg-purple-100'` (the vivid opt-in),
 * `slideBorder: 'border-purple-100'`, `border: 'border-purple-500'`. */
const CROPS = [
    {
        id: 'grapes',
        name: 'द्राक्ष',
        iconName: 'Grape',
        color: 'bg-purple-500',
        plots: [{ id: 'g1', name: 'Plot A' }, { id: 'g2', name: 'Plot B' }],
        supportedTasks: [],
        workflow: [],
    },
    {
        id: 'sugarcane',
        name: 'ऊस',
        iconName: 'Sugarcane',
        color: 'bg-green-600',
        plots: [{ id: 's1', name: 'Plot C' }],
        supportedTasks: [],
        workflow: [],
    },
] as unknown as CropProfile[];

/** The default path exactly as `Attendance.tsx` renders it: `mode="log"`, no
 * `hideGlobalCard`, and — crucially — NO `LanguageProvider` wrapper. */
function renderDefaultPath(selectedCrops: string[] = []) {
    return render(
        <CropSelector
            mode="log"
            crops={CROPS}
            selectedCrops={selectedCrops}
            selectedPlots={{}}
            onSelectionChange={vi.fn()}
            disabled={false}
        />,
    );
}

describe('CropSelector default path — no LanguageProvider required', () => {
    it('renders outside LanguageProvider without throwing', () => {
        // `useLanguage()` throws "must be used within LanguageProvider".
        // Before F5 this render aborted the whole subtree.
        expect(() => renderDefaultPath()).not.toThrow();
        expect(screen.getByTestId('crop-card-grapes')).toBeInTheDocument();
        expect(screen.getByText('Entire Farm')).toBeInTheDocument();
    });

    it('renders the plot tray outside LanguageProvider too, for a multi-plot crop', () => {
        expect(() => renderDefaultPath(['grapes'])).not.toThrow();
        expect(screen.getAllByTestId('plot-tray-button')).toHaveLength(2);
        expect(screen.getByText('Select Plot')).toBeInTheDocument();
    });
});

describe('CropSelector default path — the crop card keeps its pre-branch look', () => {
    it('a selected card uses the -50 tint and the 3px ring, not strongFill and 4px', () => {
        renderDefaultPath(['grapes']);
        const card = screen.getByTestId('crop-card-grapes');

        // What main rendered.
        expect(card.className).toContain('bg-purple-50');
        expect(card.className).toContain('ring-[3px]');
        expect(card.className).toContain('shadow-[0_20px_50px_-12px_rgba(0,0,0,0.3)]');

        // What only the founder-approved log screen may render.
        expect(card.className).not.toContain('bg-purple-100');
        expect(card.className).not.toContain('ring-[4px]');
        expect(card.className).not.toContain('rgba(0,0,0,0.35)');
    });

    it('an unselected sibling dims exactly as far as it used to, and no further', () => {
        renderDefaultPath(['grapes']);
        const other = screen.getByTestId('crop-card-sugarcane');

        expect(other.className).toContain('opacity-50');
        expect(other.className).toContain('grayscale-[0.8]');
        expect(other.className).toContain('scale-95');

        expect(other.className).not.toContain('opacity-40');
        expect(other.className).not.toContain('scale-90');
    });

    it('the photo ring keeps the pale -100 border over the -50 tint', () => {
        renderDefaultPath(['grapes']);
        const ring = screen.getByTestId('crop-photo-ring-grapes');

        expect(ring.className).toContain('border-purple-100');
        expect(ring.className).toContain('bg-purple-50');

        // The vivid version swaps both for the full -500 border and the
        // -100 fill, at double width.
        expect(ring.className).not.toContain('border-2');
        expect(ring.className).not.toContain('border-purple-500');
        expect(ring.className).not.toContain('bg-purple-100');
    });

    it('the count pill keeps its translucent white/60 background and tight padding', () => {
        renderDefaultPath(['grapes']);
        const pill = screen.getByTestId('crop-count-pill-grapes');

        expect(pill).toHaveTextContent('0 SELECTED');
        expect(pill.className).toContain('bg-white/60');
        expect(pill.className).toContain('px-2');
        expect(pill.className).toContain('py-0.5');

        expect(pill.className).not.toContain('bg-white/90');
        expect(pill.className).not.toContain('px-2.5');
        expect(pill.className).not.toContain('shadow-sm');
    });

    it('the tick badge keeps its original size, offset and hairline white border', () => {
        renderDefaultPath(['grapes']);
        const tick = screen.getByTestId('crop-tick-grapes');

        expect(tick.className).toContain('-bottom-5');
        expect(tick.className).toContain('shadow-xl');
        expect(tick.className).toContain('border-white/20');
        expect(tick.className).toContain('ring-white/50');

        expect(tick.className).not.toContain('-bottom-6');
        expect(tick.className).not.toContain('shadow-2xl');
        expect(tick.className).not.toContain('p-2.5');
        expect(tick.className).not.toContain('ring-white/70');

        // The icon itself, not a class: 24px as before, not the log
        // screen's 28.
        const icon = tick.querySelector('svg');
        expect(icon).toBeTruthy();
        expect(icon?.getAttribute('width')).toBe('24');
        expect(icon?.getAttribute('height')).toBe('24');
    });
});

describe('CropSelector default path — layout and copy are untouched', () => {
    it('keeps the Entire Farm card in the carousel and never renders the demoted row', () => {
        renderDefaultPath();

        expect(screen.getByText('Entire Farm')).toBeInTheDocument();
        expect(screen.getByText('Overview')).toBeInTheDocument();
        expect(screen.queryByTestId('crop-selector-entire-farm-row')).not.toBeInTheDocument();
    });

    it('keeps the original English header copy and never renders the founder Marathi', () => {
        renderDefaultPath();

        expect(screen.getByText('Select the plots you worked on today')).toBeInTheDocument();
        expect(
            screen.getByText('You can select multiple crops or multiple plots where same work was executed'),
        ).toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.mr.plotSectionHeader)).not.toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.mr.plotSectionHint)).not.toBeInTheDocument();
    });
});
