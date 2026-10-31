// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-57 = 1A) — "बदला" on a हजेरी-door record opens
 * THAT DAY in the हजेरी वही: the day highlighted, a person tapped हजर → अर्धा → नाही, "जतन करा" writes one mark per person
 * he changed, for that day; the date opens the calendar to ANY earlier day (never a future one). Names stay as they are,
 * nothing is summed into a count (P7), an untouched person gets no mark, and a past day whose marks are not all on this
 * phone is shown, not changed. Both languages.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../i18n/translations');
    const ctx = () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => t(k, lang.value) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import { HajeriDayEdit } from '../HajeriDayEdit';
import type { LabourData, LedgerCell } from '../../labour.types';

const cell = (day: LedgerCell['day']): LedgerCell => ({ day, night: null, hours: null, extraHours: null, ukte: false } as unknown as LedgerCell);
const DATA = {
    ledger: {
        weekLabel: '', crewRows: [],
        days: ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'],
        rows: [
            { personId: 'op:1', fieldOperatorId: 'f1', name: 'रमेश', initial: 'र', tone: 'emerald', cells: [cell('full'), cell('full'), cell('full'), cell('full')] },
            { personId: 'op:2', fieldOperatorId: 'f2', name: 'बाळू', initial: 'बा', tone: 'amber', cells: [cell('full'), cell('half'), cell('full'), null] },
            { personId: 'op:3', fieldOperatorId: 'f3', name: 'गीता', initial: 'गी', tone: 'violet', cells: [null, null, cell('full'), null] },
        ],
    },
} as unknown as LabourData;

const draw = (over: Partial<React.ComponentProps<typeof HajeriDayEdit>> = {}) => {
    const onSave = vi.fn(async () => undefined);
    const onDay = vi.fn();
    const onToast = vi.fn();
    const r = render(<HajeriDayEdit data={DATA} day="2026-10-29" onDay={onDay} allowed safe onSave={onSave} onToast={onToast} todayKey="2026-10-31" {...over} />);
    return { ...r, onSave, onDay, onToast };
};

afterEach(() => { cleanup(); lang.value = 'mr'; });

describe.each(['mr', 'en'] as const)('हजेरी वही — one day (%s)', language => {
    const words = language === 'en' ? { Full: 'Present', Half: 'Half', Absent: 'Absent' } : { Full: 'हजर', Half: 'अर्धा', Absent: 'नाही' };

    it('the chosen day highlighted with the two days before it; names as they are; no total anywhere (P7)', () => {
        lang.value = language;
        draw();
        expect(screen.getByTestId('hajeri-day-date')).toHaveTextContent(language === 'en' ? 'Thu, 29 Oct' : 'गुरु, 29 ऑक्टो');
        expect(screen.getByTestId('hajeri-day-head-2026-10-29').className).toContain('bg-emerald-600');
        expect(screen.getByTestId('hajeri-day-head-2026-10-27')).toBeInTheDocument();
        expect(screen.getByTestId('hajeri-day-name-f2')).toHaveTextContent('बाळू');
        expect(screen.getByTestId('hajeri-day-cell-f1')).toHaveTextContent(words.Full);
        expect(screen.getByTestId('hajeri-day')).not.toHaveTextContent(language === 'en' ? 'people' : 'जण');
    });

    it('tap a person: हजर → अर्धा → नाही; "जतन करा" writes ONLY the people he changed, for that day', async () => {
        lang.value = language;
        const { onSave } = draw();
        fireEvent.click(screen.getByTestId('hajeri-day-cell-f2')); // full → half
        expect(screen.getByTestId('hajeri-day-cell-f2')).toHaveAttribute('data-mark', 'Half');
        fireEvent.click(screen.getByTestId('hajeri-day-cell-f3'));
        fireEvent.click(screen.getByTestId('hajeri-day-cell-f3')); // full → half → absent
        expect(screen.getByTestId('hajeri-day-cell-f3')).toHaveTextContent(words.Absent);
        await act(async () => { fireEvent.click(screen.getByTestId('hajeri-day-save')); });
        expect(onSave).toHaveBeenCalledWith([
            { fieldOperatorId: 'f2', dayMark: 'Half' },
            { fieldOperatorId: 'f3', dayMark: 'Absent' },
        ], '2026-10-29');
    });

    it('nothing changed: says so, writes nothing', async () => {
        lang.value = language;
        const { onSave, onToast } = draw();
        await act(async () => { fireEvent.click(screen.getByTestId('hajeri-day-save')); });
        expect(onSave).not.toHaveBeenCalled();
        expect(onToast).toHaveBeenCalledWith(language === 'en' ? 'Nothing changed' : 'काहीच बदललं नाही');
    });

    it('the date opens the calendar: any earlier day (never a future one), days with marks dotted', () => {
        lang.value = language;
        const { onDay } = draw();
        fireEvent.click(screen.getByTestId('hajeri-day-date'));
        expect(screen.getByTestId('day-pick-dot-2026-10-28')).toBeInTheDocument();
        expect(screen.queryByTestId('day-pick-dot-2026-10-31')).toBeNull();
        fireEvent.click(screen.getByTestId('day-pick-prev'));
        fireEvent.click(screen.getByTestId('day-pick-2026-09-15'));
        expect(onDay).toHaveBeenCalledWith('2026-09-15');
    });

    it('a past day whose marks are not all on this phone is shown, not changed — and says why', () => {
        lang.value = language;
        draw({ safe: false });
        expect(screen.getByTestId('hajeri-day-not-safe')).toBeInTheDocument();
        expect(screen.getByTestId('hajeri-day-cell-f1')).toBeDisabled();
        expect(screen.queryByTestId('hajeri-day-save')).toBeNull();
    });

    it('someone who may not change हजेरी sees the day, nothing to tap', () => {
        lang.value = language;
        draw({ allowed: false });
        expect(screen.getByTestId('hajeri-day-not-allowed')).toBeInTheDocument();
        expect(screen.getByTestId('hajeri-day-cell-f1')).toBeDisabled();
    });
});

describe('lane OF fix 1 (M7, P10) — a mark only on this phone is drawn weaker, as the हजेरी वही draws it', () => {
    it('a queued (unsynced) mark: dashed amber with the small clock, and the legend says it is on the phone', () => {
        const queued = { ...cell('full'), unsynced: true } as LedgerCell;
        const data = { ledger: { ...DATA.ledger, rows: [{ ...DATA.ledger.rows[0], cells: [queued, cell('full'), queued, null] }] } } as unknown as LabourData;
        draw({ data });
        const today = screen.getByTestId('hajeri-day-cell-f1');
        expect(today.className).toContain('border-dashed');
        expect(today.className).toContain('border-amber-300');
        expect(screen.getAllByTestId('hajeri-day-pending').length).toBeGreaterThan(0);
        expect(screen.getByTestId('hajeri-day-on-phone')).toBeInTheDocument();
    });
});
