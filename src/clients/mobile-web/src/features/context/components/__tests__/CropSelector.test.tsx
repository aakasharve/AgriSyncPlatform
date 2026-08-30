// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13)
 *
 * Pins the `hideGlobalCard` opt-in (change 4 — "संपूर्ण शेत is DEMOTED out
 * of the crop carousel"):
 *   - default (omitted) behaviour keeps the LAYOUT byte-identical to before
 *     this task — the "Entire Farm" card still renders first in the
 *     carousel, and the new quiet row never appears. This is the regression
 *     guard for `Attendance.tsx`, the one other consumer of this component,
 *     which never passes the new prop.
 *   - `hideGlobalCard` suppresses the carousel card and renders the quiet
 *     row instead, calling the SAME `onSelectionChange(['FARM_GLOBAL'], {})`
 *     shape the carousel card always has — "select FARM_GLOBAL with exactly
 *     the existing behaviour" per the task brief.
 *   - Task 15 (Labour V2 R1) — the `mode === 'log'` header/hint swap to
 *     founder-approved Marathi is now UNCONDITIONAL, not gated on
 *     `hideGlobalCard` any more (this file mocks `language: 'mr'`, so both
 *     paths below now render the founder's Marathi, never the old English
 *     dev literal).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import type { Language } from '../../../../i18n/language';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';
import type { CropProfile } from '../../../../types';

// `CropSelector` reads the language through `useOptionalLanguage` (finding
// F5 — `useLanguage` throws outside `LanguageProvider`, and this component
// must not require one). Both are mocked so this file keeps testing the
// component and not the provider. The NO-PROVIDER case is deliberately NOT
// tested here — a `vi.mock` is file-scoped, so it would be testing the mock;
// it lives in `CropSelectorDefaultPath.test.tsx`, which mocks nothing.
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'mr' as Language,
        setLanguage: () => { },
        t: (key: string) => key,
    }),
    useOptionalLanguage: () => ({
        language: 'mr' as Language,
        setLanguage: () => { },
        t: (key: string) => key,
    }),
}));

import CropSelector from '../CropSelector';

afterEach(() => {
    cleanup();
});

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
] as unknown as CropProfile[];

const TWO_CROPS = [
    ...CROPS,
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

describe('CropSelector — hideGlobalCard opt-in (Task 13, change 4)', () => {
    it('default (omitted) still renders the Entire Farm card first in the carousel — Attendance.tsx regression guard', () => {
        render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={[]}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled={false}
            />,
        );

        expect(screen.getByText(oversightTranslations.mr.entireFarmLabel)).toBeInTheDocument();
        expect(screen.queryByTestId('crop-selector-entire-farm-row')).not.toBeInTheDocument();
        // Task 15 — the header is now founder-approved Marathi
        // UNCONDITIONALLY; the old English dev literal is no longer
        // reachable on this (omitted) path either.
        expect(screen.getByText(oversightTranslations.mr.plotSectionHeader)).toBeInTheDocument();
        expect(screen.queryByText('Select the plots you worked on today')).not.toBeInTheDocument();
    });

    it('hideGlobalCard suppresses the carousel card and renders the quiet row instead', () => {
        render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={[]}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled={false}
                hideGlobalCard
            />,
        );

        expect(screen.queryByText('Entire Farm')).not.toBeInTheDocument();
        const row = screen.getByTestId('crop-selector-entire-farm-row');
        expect(row).toBeInTheDocument();
        expect(row).toHaveTextContent(oversightTranslations.mr.entireFarmLabel);
        expect(row).toHaveTextContent(oversightTranslations.mr.entireFarmHint);
    });

    it('tapping the quiet row selects FARM_GLOBAL with exactly the existing behaviour', () => {
        const onSelectionChange = vi.fn();
        render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={[]}
                selectedPlots={{}}
                onSelectionChange={onSelectionChange}
                disabled={false}
                hideGlobalCard
            />,
        );

        fireEvent.click(screen.getByTestId('crop-selector-entire-farm-row'));
        expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(['FARM_GLOBAL'], {});
    });

    it('tapping the quiet row again while FARM_GLOBAL is already selected clears it — mirrors the carousel card toggle', () => {
        const onSelectionChange = vi.fn();
        render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={['FARM_GLOBAL']}
                selectedPlots={{}}
                onSelectionChange={onSelectionChange}
                disabled={false}
                hideGlobalCard
            />,
        );

        fireEvent.click(screen.getByTestId('crop-selector-entire-farm-row'));
        expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith([], {});
    });

    it('the section header and hint are founder-approved Marathi with hideGlobalCard set too (Task 15 — unconditional either way)', () => {
        render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={[]}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled={false}
                hideGlobalCard
            />,
        );

        expect(screen.getByText(oversightTranslations.mr.plotSectionHeader)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.plotSectionHint)).toBeInTheDocument();
        expect(screen.queryByText('Select the plots you worked on today')).not.toBeInTheDocument();
    });

    it('disabled disables the quiet row too', () => {
        render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={[]}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled
                hideGlobalCard
            />,
        );

        expect(screen.getByTestId('crop-selector-entire-farm-row')).toBeDisabled();
    });

    it('the_entire_farm_row_shows_an_unmistakable_selected_state', () => {
        // Founder, on the built screen: "at the entire farm selection, it's
        // not highlighted, user is unable to understand whether it's
        // chosen" / "highlight संपूर्ण शेत in green colour." Task 14, change
        // 3 — selected must be unmistakably emerald (spec §P-G); unselected
        // must stay full-colour and legible, never washed-out grey.
        const { rerender } = render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={[]}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled={false}
                hideGlobalCard
            />,
        );

        const unselectedRow = screen.getByTestId('crop-selector-entire-farm-row');
        expect(unselectedRow.className).not.toContain('emerald');
        expect(unselectedRow).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByTestId('crop-selector-entire-farm-row-selected-tick')).not.toBeInTheDocument();

        rerender(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={['FARM_GLOBAL']}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled={false}
                hideGlobalCard
            />,
        );

        const selectedRow = screen.getByTestId('crop-selector-entire-farm-row');
        expect(selectedRow).toHaveAttribute('aria-pressed', 'true');
        // Border AND background both carry the emerald selected state —
        // not just a tick swap.
        expect(selectedRow.className).toContain('border-emerald-500');
        expect(selectedRow.className).toContain('bg-emerald-50');
        // A FILLED emerald tick, not the old grey CheckCircle2.
        const tick = screen.getByTestId('crop-selector-entire-farm-row-selected-tick');
        expect(tick.className).toContain('bg-emerald-600');
    });
});

describe('CropSelector — crop card vividness on the OPTED-IN path (Task 16, Problem 2)', () => {
    // Founder: "make the plot selection UI more vivid — the user must be
    // able to know what he selected... but it must be aligned with the
    // aesthetic and UI of the whole app." Assertions below check things a
    // user would actually SEE (a checkmark badge appearing/disappearing,
    // a thicker themed ring, a greyed-and-shrunk sibling) — not a class
    // name that merely happens to differ.
    //
    // FINDING F5 — every render below now passes `hideGlobalCard`, the log
    // screen's opt-in. The founder directed this change and approved it
    // THERE; it shipped ungated, so `Attendance.tsx` inherited it too. Spec
    // §5.1 forbids that. The default path is pinned separately, and
    // oppositely, in `CropSelectorDefaultPath.test.tsx`.
    it('a selected crop card shows a real checkmark badge and a thicker, fully-themed ring', () => {
        render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={['grapes']}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled={false}
                hideGlobalCard
            />,
        );

        const card = screen.getByTestId('crop-card-grapes');
        expect(card).toHaveAttribute('aria-pressed', 'true');
        expect(card.className).toContain('scale-110');
        expect(card.className).toContain('ring-[4px]');
        expect(card.className).toContain('bg-purple-100'); // strongFill for the purple theme

        // A real, visible checkmark badge — an actual SVG icon, not a class.
        const tick = screen.getByTestId('crop-tick-grapes');
        expect(tick).toBeInTheDocument();
        expect(tick.querySelector('svg')).toBeTruthy();
    });

    it('an unselected card recedes further while a sibling is selected: greyed out and shrunk, no badge', () => {
        render(
            <CropSelector
                mode="log"
                crops={TWO_CROPS}
                selectedCrops={['grapes']}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled={false}
                hideGlobalCard
            />,
        );

        const selected = screen.getByTestId('crop-card-grapes');
        const other = screen.getByTestId('crop-card-sugarcane');

        expect(selected).toHaveAttribute('aria-pressed', 'true');
        expect(other).toHaveAttribute('aria-pressed', 'false');

        // The unselected sibling recedes further than before this task:
        // fully greyscale (was a partial grayscale-[0.8]), more transparent
        // (opacity-40, was opacity-50), and visibly smaller (scale-90, was
        // scale-95) — the contrast a farmer sees at a glance.
        expect(other.className).toContain('opacity-40');
        expect(other.className).toContain('grayscale');
        expect(other.className).not.toContain('grayscale-[0.8]');
        expect(other.className).toContain('scale-90');
        expect(screen.queryByTestId('crop-tick-sugarcane')).not.toBeInTheDocument();

        // The selected card is untouched by the dimming path.
        expect(selected.className).not.toContain('opacity-40');
        expect(selected.className).not.toContain('grayscale');
    });

    it('selected vs unselected crop cards are meaningfully different, not merely differently labelled', () => {
        const { rerender } = render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={[]}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled={false}
                hideGlobalCard
            />,
        );

        const unselected = screen.getByTestId('crop-card-grapes');
        expect(screen.queryByTestId('crop-tick-grapes')).not.toBeInTheDocument();
        expect(unselected.className).not.toContain('scale-110');
        expect(unselected.className).not.toContain('ring-[4px]');

        rerender(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={['grapes']}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled={false}
                hideGlobalCard
            />,
        );

        // Selected state adds a visible badge AND a stronger fill/ring —
        // "not only a ring" was the founder's own phrasing.
        expect(screen.getByTestId('crop-tick-grapes')).toBeInTheDocument();
        const selected = screen.getByTestId('crop-card-grapes');
        expect(selected.className).toContain('bg-purple-100'); // strongFill for the purple theme
        expect(selected.className).toContain('ring-[4px]');
    });
});

describe('CropSelector — Task 15 (Labour V2 R1): remaining English literals replaced', () => {
    // Every case below renders on the DEFAULT (omitted `hideGlobalCard`)
    // path — the one `Attendance.tsx` actually uses — because these five
    // strings were never gated in the first place; they were plain English
    // literals reachable unconditionally. `language: 'mr'` is mocked at the
    // top of this file.
    it('the carousel "Entire Farm" card renders the founder Marathi label and एकूण, never the English literals', () => {
        render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={[]}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled={false}
            />,
        );

        expect(screen.getByText(oversightTranslations.mr.entireFarmLabel)).toBeInTheDocument();
        expect(screen.getByText('एकूण')).toBeInTheDocument();
        expect(screen.queryByText('Entire Farm')).not.toBeInTheDocument();
        expect(screen.queryByText('Overview')).not.toBeInTheDocument();
    });

    it('a selected plot in the tray shows "कामे सांगण्यासाठी तयार", never "Ready to Log"', () => {
        render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={['grapes']}
                selectedPlots={{ grapes: ['g1'] }}
                onSelectionChange={vi.fn()}
                disabled={false}
            />,
        );

        expect(screen.getByText('कामे सांगण्यासाठी तयार')).toBeInTheDocument();
        expect(screen.queryByText('Ready to Log')).not.toBeInTheDocument();
    });

    it('the per-crop count pill reads १ निवडला (Devanagari, singular) for exactly one selected plot', () => {
        render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={['grapes']}
                selectedPlots={{ grapes: ['g1'] }}
                onSelectionChange={vi.fn()}
                disabled={false}
            />,
        );

        const pill = screen.getByTestId('crop-count-pill-grapes');
        expect(pill).toHaveTextContent('१ निवडला');
        expect(pill).not.toHaveTextContent('SELECTED');
    });

    it('the per-crop count pill reads २ निवडले (plural) for two selected plots — grammar, not just a number swap', () => {
        render(
            <CropSelector
                mode="log"
                crops={CROPS}
                selectedCrops={['grapes']}
                selectedPlots={{ grapes: ['g1', 'g2'] }}
                onSelectionChange={vi.fn()}
                disabled={false}
            />,
        );

        const pill = screen.getByTestId('crop-count-pill-grapes');
        expect(pill).toHaveTextContent('२ निवडले');
        expect(pill).not.toHaveTextContent('निवडला');
    });

    it('an unselected multi-plot crop shows the Devanagari plot count with an unchanged noun: २ प्लॉट', () => {
        render(
            <CropSelector
                mode="reflect"
                crops={CROPS}
                selectedCrops={[]}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled={false}
            />,
        );

        const pill = screen.getByTestId('crop-count-pill-grapes');
        expect(pill).toHaveTextContent('२ प्लॉट');
        expect(pill).not.toHaveTextContent('PLOTS');
    });

    it('a single-plot crop shows १ प्लॉट — Devanagari singular, same noun as the plural', () => {
        render(
            <CropSelector
                mode="reflect"
                crops={TWO_CROPS}
                selectedCrops={[]}
                selectedPlots={{}}
                onSelectionChange={vi.fn()}
                disabled={false}
            />,
        );

        const pill = screen.getByTestId('crop-count-pill-sugarcane');
        expect(pill).toHaveTextContent('१ प्लॉट');
        expect(pill).not.toHaveTextContent('PLOT');
    });
});
