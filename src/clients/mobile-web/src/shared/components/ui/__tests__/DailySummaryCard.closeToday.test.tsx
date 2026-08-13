// @vitest-environment jsdom
//
// spec: dfes-truthful-number-and-merge-readiness-2026-08-13 (task-10, BUG 1)
//
// DailySummaryCard — the close-today control vs. Sathi's sentence.
//
// `dfes.closeToday` is a 53-character founder-locked FIRST-PERSON sentence. It
// used to be the label of a small pill in a `justify-between` header, which is
// two jobs for one string and unrenderable at 390px. These tests pin the split:
//
//   • the CONTROL carries the short action label, never the sentence;
//   • the founder's sentence appears, verbatim and unedited, as the heading of
//     the panel that control opens;
//   • only the farmer's explicit हो reaches `onCloseToday`.
//
// The real Marathi table is used (not an echo mock), so a regression that
// re-points the pill at `dfes.closeToday` fails here.
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { t as translate } from '../../../../i18n/translations';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'mr',
        setLanguage: () => {},
        t: (key: string) => translate(key, 'mr'),
    }),
}));

const { DailySummaryCard } = await import('../DailySummaryCard');

const FOUNDER_SENTENCE = 'आजची सगळी कामे माझ्यापर्यंत पोहोचली का याची खात्री करा';

const STATS = {
    logsCount: 3,
    totalSpent: 0,
    pendingTasks: 0,
    verifiedCount: 3,
    unverifiedCount: 0,
};

afterEach(cleanup);

describe('DailySummaryCard — close-today control (BUG 1)', () => {
    it('the control carries the SHORT action label, never the 53-char sentence', () => {
        render(<DailySummaryCard date="14 Aug" stats={STATS} isToday onCloseToday={() => {}} />);

        const action = screen.getByTestId('close-today-action');
        expect(action).toHaveTextContent('खात्री करा');
        expect(action.textContent).not.toContain(FOUNDER_SENTENCE);
        // Nothing is allowed to wrap this control's label.
        expect(action.className).toContain('whitespace-nowrap');
        // Minimum tap target (CHARTER: >= 44px).
        expect(action.className).toContain('min-h-[44px]');
    });

    it('the panel is closed until the farmer opens it', () => {
        render(<DailySummaryCard date="14 Aug" stats={STATS} isToday onCloseToday={() => {}} />);

        expect(screen.queryByTestId('close-today-panel')).toBeNull();
        expect(screen.getByTestId('close-today-action')).toHaveAttribute('aria-expanded', 'false');
    });

    it("opening it shows the founder's sentence VERBATIM as the panel heading", () => {
        render(<DailySummaryCard date="14 Aug" stats={STATS} isToday onCloseToday={() => {}} />);

        fireEvent.click(screen.getByTestId('close-today-action'));

        expect(screen.getByTestId('close-today-panel-heading')).toHaveTextContent(FOUNDER_SENTENCE);
        expect(screen.getByTestId('close-today-action')).toHaveAttribute('aria-expanded', 'true');
        // Marathi heading -> Noto Serif Devanagari (CHARTER font rule).
        expect(screen.getByTestId('close-today-panel-heading').getAttribute('style'))
            .toContain('Noto Serif Devanagari');
    });

    it('opening the panel does NOT close the day and does NOT open the day view', () => {
        const onCloseToday = vi.fn();
        const onClick = vi.fn();
        render(
            <DailySummaryCard
                date="14 Aug"
                stats={STATS}
                isToday
                onClick={onClick}
                onCloseToday={onCloseToday}
            />,
        );

        fireEvent.click(screen.getByTestId('close-today-action'));

        expect(onCloseToday).not.toHaveBeenCalled();
        expect(onClick).not.toHaveBeenCalled();
    });

    it('only हो reaches onCloseToday; नाही just closes the panel', () => {
        const onCloseToday = vi.fn();
        render(<DailySummaryCard date="14 Aug" stats={STATS} isToday onCloseToday={onCloseToday} />);

        fireEvent.click(screen.getByTestId('close-today-action'));
        fireEvent.click(screen.getByTestId('close-today-no'));
        expect(onCloseToday).not.toHaveBeenCalled();
        expect(screen.queryByTestId('close-today-panel')).toBeNull();

        fireEvent.click(screen.getByTestId('close-today-action'));
        fireEvent.click(screen.getByTestId('close-today-yes'));
        expect(onCloseToday).toHaveBeenCalledTimes(1);
    });

    it('a past day still shows its completeness indicator, not the control', () => {
        render(<DailySummaryCard date="13 Aug" stats={STATS} onCloseToday={() => {}} />);

        expect(screen.queryByTestId('close-today-action')).toBeNull();
    });
});
