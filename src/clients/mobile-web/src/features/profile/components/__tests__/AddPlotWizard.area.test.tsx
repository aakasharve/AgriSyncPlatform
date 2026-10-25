// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3, acceptance h)
//
// Written by test-writer from the spec alone.
//
// The server refuses a plot without an area, so a plot saved without one could never be
// sent. The wizard's step 1 now requires an area > 0 (`plot-area`, `plot-area-error`).
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AddPlotWizard from '../AddPlotWizard';
import type { CropProfile, FarmerProfile } from '../../../../types';

const crop: CropProfile = {
    id: 'c_11111111-1111-4111-8111-111111111111',
    name: 'Grapes',
    iconName: 'Grape',
    color: 'bg-purple-500',
    plots: [],
    activeScheduleId: null,
    supportedTasks: [],
    workflow: [],
};

const profile = {
    name: 'Test Farmer',
    village: '',
    phone: '',
    language: 'mr',
    operators: [],
    activeOperatorId: '',
    waterResources: [],
    motors: [],
    machineries: [],
} as unknown as FarmerProfile;

const renderWizard = () => {
    const onSave = vi.fn();
    render(<AddPlotWizard crop={crop} profile={profile} onSave={onSave} onCancel={vi.fn()} />);
    return { onSave };
};

/** The plot name is the first text field on step 1. */
const typePlotName = (name: string) => {
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: name } });
};

const typeArea = (value: string) => {
    fireEvent.change(screen.getByTestId('plot-area'), { target: { value } });
};

const pressNext = () => {
    fireEvent.click(screen.getByRole('button', { name: /profile\.nextStep/ }));
};

const onStepOne = () => screen.queryByTestId('plot-area') !== null;

describe('AddPlotWizard — step 1 needs an area (h)', () => {
    afterEach(() => cleanup());

    it('with a plot name but NO area, Next is refused and the area error shows', () => {
        const { onSave } = renderWizard();
        typePlotName('नवीन बाग');

        pressNext();

        expect(onStepOne()).toBe(true);
        expect(screen.getByTestId('plot-area-error')).toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('an area of 0 is refused too — the server needs an area greater than zero', () => {
        renderWizard();
        typePlotName('नवीन बाग');
        typeArea('0');

        pressNext();

        expect(onStepOne()).toBe(true);
        expect(screen.getByTestId('plot-area-error')).toBeInTheDocument();
    });

    it('with an area, Next moves past step 1 and no area error shows', () => {
        renderWizard();
        typePlotName('नवीन बाग');
        typeArea('2');

        pressNext();

        expect(onStepOne()).toBe(false);
        expect(screen.queryByTestId('plot-area-error')).not.toBeInTheDocument();
    });

    it('after being refused, entering an area lets the farmer continue', () => {
        renderWizard();
        typePlotName('नवीन बाग');
        pressNext();
        expect(onStepOne()).toBe(true);

        typeArea('20');
        pressNext();

        expect(onStepOne()).toBe(false);
    });
});
