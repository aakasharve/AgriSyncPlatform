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
//
// ======================================================================
// 🔴 ONE TEST IN THIS FILE IS DELIBERATELY RED, AWAITING A FOUNDER RULING.
//    DO NOT "FIX" IT. IT IS NOT A DEFECT AND NOT A MERGE ERROR.
// ======================================================================
//
// "opening it shows the founder's sentence VERBATIM as the panel heading"
// fails, and it is the only failure here. `main` and `feat/dfes-companion`
// each rewrote `dfes.closeToday` from the same base ('आज बंद करा'), into two
// different sentences that differ on ONE open question — नोंदी (records) vs
// कामे (work):
//
//   main (LIVE on farmers' phones, and the value in i18n/dfesTranslations.ts):
//     'आजची सगळी कामे माझ्यापर्यंत पोहोचली का याची खात्री करा'
//   dfes (recorded in dfesTranslations.ts, left UNAPPLIED; asserted below):
//     'आजची सगळी कामे माझ्यापर्यंत पोहोचली का याची खात्री करा'
//
// `i18n/dfesTranslations.ts`'s own header marks this as the one ruling that
// is "DELIBERATELY UNSETTLED" — नोंद is banned from Shram Sathi's first-person
// voice and legitimate in UI chrome, and which side this string falls on has
// not been answered. It also carries the standing instruction: "Do not
// resolve this by reasoning about it — it was closed that way once and
// reverted." A merge may not pick between two founder-facing strings, and
// neither may a test.
//
// The assertion is therefore left EXACTLY as dfes wrote it, red, so the
// question stays visible until the founder answers it. Everything else this
// file pins — the control carries the short label and never the sentence, the
// panel starts closed, opening it neither closes the day nor navigates, only
// हो reaches `onCloseToday`, and the Devanagari serif font rule — is
// independent of the wording and passes.
//
// TO CLOSE THIS: the founder picks a sentence. Whichever he picks becomes
// `mr.closeToday` in `i18n/dfesTranslations.ts` AND `FOUNDER_SENTENCE` below,
// and this note is deleted.
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
