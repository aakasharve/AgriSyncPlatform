// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13)
 *
 * Pins the `hideGlobalCard` opt-in (change 4 — "संपूर्ण शेत is DEMOTED out
 * of the crop carousel"):
 *   - default (omitted) behaviour is BYTE-IDENTICAL to before this task —
 *     the "Entire Farm" card still renders first in the carousel, and the
 *     new quiet row never appears. This is the regression guard for
 *     `Attendance.tsx`, the one other consumer of this component, which
 *     never passes the new prop.
 *   - `hideGlobalCard` suppresses the carousel card and renders the quiet
 *     row instead, calling the SAME `onSelectionChange(['FARM_GLOBAL'], {})`
 *     shape the carousel card always has — "select FARM_GLOBAL with exactly
 *     the existing behaviour" per the task brief.
 *   - the `mode === 'log'` header/hint swap to founder-approved Marathi is
 *     gated on the same prop.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import type { Language } from '../../../../i18n/language';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';
import type { CropProfile } from '../../../../types';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
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

        expect(screen.getByText('Entire Farm')).toBeInTheDocument();
        expect(screen.queryByTestId('crop-selector-entire-farm-row')).not.toBeInTheDocument();
        // Legacy English header copy is unchanged when the prop is omitted.
        expect(screen.getByText('Select the plots you worked on today')).toBeInTheDocument();
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

    it('the section header and hint swap to founder-approved Marathi only when hideGlobalCard is set', () => {
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
});
