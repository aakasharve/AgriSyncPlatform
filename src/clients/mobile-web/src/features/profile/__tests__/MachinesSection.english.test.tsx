// @vitest-environment jsdom
/**
 * Repair FIX-1 round 1, Bug 5 (screen 3 of 4): English mode is English only on the machine list and form (item 7) — the
 * six type names, the details and their placeholders, "Change machine", the card line — no Devanagari, Latin digits.
 * The one exception is names the farmer typed. Marathi mode stays exactly as it is.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ language: 'en' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: h.language }),
}));

import MachinesSection from '../sections/MachinesSection';
import { VerificationStatus, type FarmerProfile, type FarmMachinery } from '../../../domain/types/farm.types';

const DEVANAGARI = /[ऀ-ॿ]/;
const shownWords = (root: HTMLElement) => [
    root.textContent ?? '',
    ...Array.from(root.querySelectorAll('[placeholder]')).map(el => el.getAttribute('placeholder') ?? ''),
    ...Array.from(root.querySelectorAll('[aria-label]')).map(el => el.getAttribute('aria-label') ?? ''),
].join(' | ');

const machines: FarmMachinery[] = [
    { id: 'b', name: 'Mitra blower', type: 'Blower', ownership: 'Owned', company: 'Mitra', model: 'MB-500', nozzleCount: 4, capacity: 200, otherDetails: 'both sides' },
    { id: 't', name: 'Mahindra 575', type: 'Tractor', ownership: 'Rented', hp: 45 },
];
const profile = (list?: FarmMachinery[]): FarmerProfile => ({
    name: 'T', village: 'V', phone: '9', language: 'en', verificationStatus: VerificationStatus.PhoneVerified,
    operators: [], waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
    ...(list ? { machineries: list } : {}),
});

afterEach(() => { cleanup(); h.language = 'en'; });

describe('यंत्रं — English mode is English only', () => {
    it('the list, the add form for every type, and the change form', () => {
        const { container } = render(<MachinesSection profile={profile(machines)} onUpdate={vi.fn()} />);
        expect(screen.getByTestId('machine-b')).toHaveTextContent('Owned · Blower · Mitra MB-500 · 4 nozzles · Tank 200 litres');
        expect(screen.getByTestId('machine-t')).toHaveTextContent('Rented · Tractor · 45 HP');
        expect(shownWords(container)).not.toMatch(DEVANAGARI);

        fireEvent.click(screen.getByTestId('machine-add'));
        for (const t of ['Tractor', 'Blower', 'Sprayer', 'Rotavator', 'Harvester', 'Other']) {
            fireEvent.click(screen.getByTestId(`machine-type-${t}`));
            expect(shownWords(container)).not.toMatch(DEVANAGARI);
        }
        const chips = Array.from(screen.getByTestId('machine-form').querySelectorAll('[data-testid^="machine-type-"]')).map(el => el.textContent);
        expect(chips).toEqual(['Tractor', 'Blower', 'Sprayer', 'Rotavator', 'Harvester', 'Other']);
        fireEvent.click(screen.getByTestId('machine-cancel'));

        fireEvent.click(screen.getByTestId('machine-edit-b'));
        expect(screen.getByTestId('machine-form')).toHaveTextContent('Change machine');
        expect(shownWords(container)).not.toMatch(DEVANAGARI);
    });

    it('with no machine yet: English only', () => {
        const { container } = render(<MachinesSection profile={profile()} onUpdate={vi.fn()} />);
        expect(shownWords(container)).not.toMatch(DEVANAGARI);
    });

    it('Marathi mode stays exactly as it is', () => {
        h.language = 'mr';
        render(<MachinesSection profile={profile(machines)} onUpdate={vi.fn()} />);
        expect(screen.getByTestId('machine-b')).toHaveTextContent('स्वतःचं · ब्लोअर · Mitra MB-500 · 4 नोझल · टाकी 200 लिटर');
        fireEvent.click(screen.getByTestId('machine-edit-b'));
        expect(screen.getByTestId('machine-form')).toHaveTextContent('यंत्र बदला');
        expect(screen.getByTestId('machine-form')).toHaveTextContent('नोझलची संख्या');
        expect(screen.getByTestId('machine-form')).toHaveTextContent('इतर माहिती');
    });
});
