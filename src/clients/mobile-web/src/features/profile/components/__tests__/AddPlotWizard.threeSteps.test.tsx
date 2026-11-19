// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 - found 2026-11-19 while reading how a schedule is chosen.
//
// The add-plot wizard has THREE steps (its header says N/3). The footer test was `step < 4`, so on step 3 the button still said "next" and
// led to a blank step 4 before "finish". Step 3 now ends with the finish button, and it saves.
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
    name: 'Test Farmer', village: '', phone: '', language: 'mr', operators: [], activeOperatorId: '',
    waterResources: [], motors: [], machineries: [],
} as unknown as FarmerProfile;

const next = () => fireEvent.click(screen.getByRole('button', { name: /profile\.nextStep/ }));

/** Fills every text and number field on the current step with something valid, so a step's own validation passes. */
const fillStep = () => {
    for (const el of Array.from(document.querySelectorAll('input, textarea')) as HTMLInputElement[]) {
        if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden') continue;
        fireEvent.change(el, { target: { value: el.type === 'number' ? '5' : 'abc' } });
    }
};

describe('AddPlotWizard - three steps, the last one finishes', () => {
    afterEach(() => cleanup());

    it('steps 1 and 2 say next; step 3 says finish (no blank step 4) and saves', () => {
        const onSave = vi.fn();
        render(<AddPlotWizard crop={crop} profile={profile} onSave={onSave} onCancel={vi.fn()} />);

        expect(screen.getByText('profile.step 1/3')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /profile\.finishSetup/ })).toBeNull();
        fillStep();
        next();

        expect(screen.getByText('profile.step 2/3')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /profile\.finishSetup/ })).toBeNull();
        fillStep();
        next();

        expect(screen.getByText('profile.step 3/3')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /profile\.nextStep/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /profile\.finishSetup/ }));
        expect(onSave).toHaveBeenCalledTimes(1);
    });
});
