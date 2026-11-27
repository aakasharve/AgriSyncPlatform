// @vitest-environment jsdom
/**
 * Repair FIX-1 round 1, Bug 5 (screen 2 of 4): English mode is English only on the "पाणी आणि वीज" page — every word of
 * the sources and their motors, the source form (both steps), the power timetable (week A / B, the strip, the times,
 * the checks and the save), the "this phone only" line and the "coming soon" line. Names the farmer typed are the one
 * exception. Marathi mode stays exactly as it is.
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

import UtilitiesSection from '../sections/UtilitiesSection';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';

const DEVANAGARI = /[ऀ-ॿ]/;
const shownWords = (root: HTMLElement) => [
    root.textContent ?? '',
    ...Array.from(root.querySelectorAll('[placeholder]')).map(el => el.getAttribute('placeholder') ?? ''),
    ...Array.from(root.querySelectorAll('[aria-label]')).map(el => el.getAttribute('aria-label') ?? ''),
].join(' | ');

const cut = (id: string, startTime: string, endTime: string) => ({ id, startTime, endTime, repeatRule: 'DAILY' as const, days: ['Mon'] });
const profile = {
    name: 'T', village: 'V', phone: '9', language: 'en', verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [{ id: 'w1', type: 'Well', name: 'Main well', isAvailable: true }, { id: 'w2', type: 'Canal', name: 'Canal', isAvailable: true }],
    motors: [{ id: 'm1', name: 'Pump', hp: 7.5, phase: '3', powerSourceType: 'MSEB', linkedWaterSourceId: 'w1',
        dripDetails: { pipeSize: '16mm', hasFilter: true, flowRatePerHour: 8000 } }],
    electricityTiming: {
        singlePhase: { patternMode: 'ROTATIONAL', alternateWeeklyPattern: true, weekAOffWindows: [cut('a', '06:00', '09:00')], weekBOffWindows: [cut('b', '18:00', '21:00')] },
        threePhase: { patternMode: 'FIXED_WEEKLY', alternateWeeklyPattern: false, weekAOffWindows: [], weekBOffWindows: [] },
    },
    infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as unknown as FarmerProfile;

afterEach(() => { cleanup(); h.language = 'en'; });

describe('पाणी आणि वीज — English mode is English only', () => {
    it('the sources, an open source with its motor, the timetable, a wrong time, and the source form', () => {
        const { container } = render(<UtilitiesSection profile={profile} onUpdate={vi.fn()} />);
        expect(shownWords(container)).not.toMatch(DEVANAGARI);

        fireEvent.click(screen.getByTestId('source-toggle-w1'));
        expect(screen.getByTestId('motor-m1')).toHaveTextContent('7.5 HP · Three phase · Grid (MSEB)');
        fireEvent.click(screen.getByTestId('source-remove-w1'));
        expect(shownWords(container)).not.toMatch(DEVANAGARI);

        // a wrong time is said in English, and so is the refusal to save it
        fireEvent.change(screen.getByTestId('start-singlePhase-A'), { target: { value: '09:00' } });
        fireEvent.click(screen.getByTestId('power-save'));
        expect(screen.getByTestId('power-errors')).toBeInTheDocument();
        expect(shownWords(container)).not.toMatch(DEVANAGARI);

        fireEvent.click(screen.getByTestId('source-add'));
        expect(shownWords(container)).not.toMatch(DEVANAGARI);
        fireEvent.click(screen.getByTestId('source-next')); // no name: the form says so
        expect(shownWords(container)).not.toMatch(DEVANAGARI);
        fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'New well' } });
        fireEvent.click(screen.getByTestId('source-next'));
        fireEvent.click(screen.getByTestId('motor-drip-1-yes'));
        expect(shownWords(container)).not.toMatch(DEVANAGARI);
    });

    it('a saved timetable says so in English', () => {
        const { container } = render(<UtilitiesSection profile={profile} onUpdate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('nocut-threePhase-A'));
        fireEvent.click(screen.getByTestId('power-save'));
        expect(screen.getByTestId('power-msg')).toHaveTextContent('Power times saved');
        expect(shownWords(container)).not.toMatch(DEVANAGARI);
    });

    it('Marathi mode stays exactly as it is', () => {
        h.language = 'mr';
        render(<UtilitiesSection profile={profile} onUpdate={vi.fn()} />);
        expect(screen.getByText('पाण्याचे स्रोत')).toBeInTheDocument();
        expect(screen.getByText('वीज कधी असते?')).toBeInTheDocument();
        expect(screen.getByTestId('setup-this-phone-only')).toHaveTextContent('फक्त या फोनवर साठवलं जातं');
        fireEvent.click(screen.getByTestId('source-toggle-w1'));
        expect(screen.getByTestId('motor-m1')).toHaveTextContent('7.5 HP · थ्री फेज · महावितरण वीज');
        expect(screen.getByTestId('soon')).toHaveTextContent('लवकरच');
    });
});
