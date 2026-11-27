// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1a. The first-record card: the founder's
 * own words in Marathi mode (Q5, 27 Nov, verbatim), English only in English mode (PROPOSED twins), one start, one "later",
 * one "← मागे".
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const lang = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: lang.language, setLanguage: () => undefined, t: (k: string) => k }),
}));
vi.mock('../DawnScene', () => ({ default: () => null }));

import FirstRecordCard from '../FirstRecordCard';

afterEach(() => { cleanup(); lang.language = 'mr'; });

const textOf = (testId: string) => screen.getByTestId(testId).textContent ?? '';
const DEVANAGARI = /[ऀ-ॿ]/;

describe('the first-record card', () => {
    it('Marathi mode: his four lines, exactly as he wrote them, and no English', () => {
        render(<FirstRecordCard onStart={vi.fn()} onLater={vi.fn()} onBack={vi.fn()} />);
        expect(textOf('first-record-title')).toBe('आज शेतात काय काय केलं?');
        expect(textOf('first-record-line')).toBe('जसं आठवतंय, तसं सांगा. बाकी आम्ही करू.');
        expect(textOf('first-record-start')).toBe('बोलायला सुरुवात करा');
        expect(textOf('first-record-later')).toBe('नंतर सांगेन');
        expect(textOf('first-run-back')).toBe('मागे');
        expect(screen.getByTestId('first-record-card').textContent).not.toMatch(/[A-Za-z]/);
    });

    it('English mode: English only (no Devanagari)', () => {
        lang.language = 'en';
        render(<FirstRecordCard onStart={vi.fn()} onLater={vi.fn()} onBack={vi.fn()} />);
        expect(textOf('first-record-title')).toBe('What all did you do on the farm today?');
        expect(textOf('first-record-line')).toBe('Tell it as you remember it. We will do the rest.');
        expect(textOf('first-record-start')).toBe('Start speaking');
        expect(textOf('first-record-later')).toBe('I will tell later');
        expect(screen.getByTestId('first-record-card').textContent).not.toMatch(DEVANAGARI);
    });

    it('each button does its one thing', () => {
        const onStart = vi.fn();
        const onLater = vi.fn();
        const onBack = vi.fn();
        render(<FirstRecordCard onStart={onStart} onLater={onLater} onBack={onBack} />);
        fireEvent.click(screen.getByTestId('first-record-start'));
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(onLater).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('first-record-later'));
        expect(onLater).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('first-run-back'));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('the text is set in the app\'s Devanagari body face (no system or generic face named)', () => {
        render(<FirstRecordCard onStart={vi.fn()} onLater={vi.fn()} />);
        expect(screen.getByTestId('first-record-card').style.fontFamily).toMatch(/^["']Noto Sans Devanagari["'], sans-serif$/);
        expect(document.body.innerHTML).not.toMatch(/system-ui|Arial/);
    });
});
