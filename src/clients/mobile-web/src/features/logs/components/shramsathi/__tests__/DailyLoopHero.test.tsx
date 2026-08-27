// @vitest-environment jsdom
//
// spec: dfes-companion-2026-07-11
//
// Daily Clarity Loop v1 — morning-trigger hero. These tests bind the hero to
// Marathi (via a mocked useLanguage → real translations) so we assert the exact
// farmer-facing copy: "आज {N} कामं बाकी", the empty-day invite, and the folded
// carried qualifier (Fix 1: a subset of TODAY's N, never a divergent count —
// naming a single carried task, or "(यातील {k} काल पासून)" for several). No
// async Dexie-backed LanguageProvider needed.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { t as translate } from '../../../../../i18n/translations';
import DailyLoopHero from '../DailyLoopHero';

vi.mock('../../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'mr',
        setLanguage: () => {},
        t: (key: string) => translate(key, 'mr'),
    }),
}));

afterEach(() => {
    cleanup();
});

/** The settled sentence the founder had removed on 2026-08-27. Read from the
 * table, never retyped: the key still exists in `dfesTranslations.ts` (approved
 * copy is not deleted), so a re-wiring of it must fail these tests. */
const SETTLED_LINE = translate('dfes.dailyLoopDaySettled', 'mr');

describe('DailyLoopHero (Daily Clarity Loop v1 morning trigger)', () => {
    it('shows "आज N कामं बाकी" when work is left (N > 0)', () => {
        render(
            <DailyLoopHero pendingCount={5} carriedCount={0} closurePercent={40} onFocusRecorder={() => {}} />,
        );
        expect(screen.getByTestId('daily-loop-hero-line')).toHaveTextContent('आज 5 कामं बाकी');
    });

    // Wave 2.4: this used to be rendered with closurePercent={100} — i.e. the
    // test itself encoded the contradiction (a full ring beside "you told me
    // nothing today"). A day nothing has been told about now scores 0 at the
    // source (dayState.ts), which is what is passed here.
    it('shows the empty-day invite (no scolding, no count) when N === 0 and nothing was recorded', () => {
        render(
            <DailyLoopHero pendingCount={0} carriedCount={0} closurePercent={0} onFocusRecorder={() => {}} />,
        );
        expect(screen.getByTestId('daily-loop-hero-line')).toHaveTextContent('आज काहीच सांगितलं नाही. काम झालं नसेल तर कारण सांगा — किंवा "आज काम नाही" एवढं सांगा.');
        expect(screen.queryByTestId('daily-loop-hero-carried')).not.toBeInTheDocument();
    });

    // ---- Wave 2.4: the ring and the line cannot state opposite things -------

    it('shows NO percentage on a day nothing was told about — a dash, not a 0% that reads as failure', () => {
        render(
            <DailyLoopHero pendingCount={0} carriedCount={0} closurePercent={0} onFocusRecorder={() => {}} />,
        );
        const ring = screen.getByTestId('daily-loop-hero-ring');
        expect(ring).toHaveTextContent('—');
        expect(ring).not.toHaveTextContent('%');
        // And the line agrees with it: nothing told.
        expect(screen.getByTestId('daily-loop-hero-line')).toHaveTextContent('आज काहीच सांगितलं नाही');
    });

    // ---- Founder ruling 2026-08-27: the settled day belongs to the strip ----

    it('the_settled_day_renders_no_card_at_all (N === 0, closure > 0)', () => {
        // The founder read this component's "आज सगळं सांगून झालं — काही बाकी
        // नाही" directly beneath the oversight strip's own all-clear and ruled:
        // "there are two line only keep which is on the oversight bar."
        // Deleted at source, NOT gated — so there is no input under which this
        // component speaks it, and no signal left to publish.
        render(
            <DailyLoopHero pendingCount={0} carriedCount={0} closurePercent={100} onFocusRecorder={() => {}} />,
        );
        expect(screen.queryByTestId('daily-loop-hero')).toBeNull();
        expect(screen.queryByText(SETTLED_LINE)).toBeNull();
        expect(document.body.textContent).not.toContain(SETTLED_LINE);
    });

    it('the_settled_sentence_reaches_no_screen_at_any_closure_percent', () => {
        // The old branch was `closurePercent > 0`, so a sweep across that
        // boundary is what catches a partial revert. `0` is the empty-day
        // invite (asserted above); every value above it must render nothing.
        for (const closurePercent of [1, 25, 70, 99, 100]) {
            render(
                <DailyLoopHero pendingCount={0} carriedCount={0} closurePercent={closurePercent} onFocusRecorder={() => {}} />,
            );
            expect(screen.queryByTestId('daily-loop-hero'), String(closurePercent)).toBeNull();
            expect(document.body.textContent).not.toContain(SETTLED_LINE);
            cleanup();
        }
    });

    it('the two states that do NOT restate the strip are untouched', () => {
        // The ruling removed one sentence, not the card. "N tasks left" and
        // "nothing told yet" are not all-clears — they do not restate the
        // strip, and deleting them would be losing true lines with no home.
        render(
            <DailyLoopHero pendingCount={5} carriedCount={0} closurePercent={40} onFocusRecorder={() => {}} />,
        );
        expect(screen.getByTestId('daily-loop-hero-line')).toHaveTextContent('आज 5 कामं बाकी');
        // The day-closure ring survives HERE — it is the one surface that still
        // carries `closurePercent`, and it could not move to the strip (a
        // proportion of today's planned work is not a count of waiting rows).
        expect(screen.getByTestId('daily-loop-hero-ring')).toHaveTextContent('40%');
        cleanup();

        render(
            <DailyLoopHero pendingCount={0} carriedCount={0} closurePercent={0} onFocusRecorder={() => {}} />,
        );
        expect(screen.getByTestId('daily-loop-hero-line')).toHaveTextContent('आज काहीच सांगितलं नाही');
    });

    it('names the single carried task (no bare count) when exactly one carried over', () => {
        render(
            <DailyLoopHero pendingCount={3} carriedCount={1} carriedTitle="फवारणी" closurePercent={40} onFocusRecorder={() => {}} />,
        );
        expect(screen.getByTestId('daily-loop-hero-carried')).toHaveTextContent('काल पासून: फवारणी');
    });

    it('folds in a soft carried QUALIFIER of the same N when several carried over (k <= N)', () => {
        // pendingCount = N (today's number); carriedCount = k is a subset of it.
        render(
            <DailyLoopHero pendingCount={5} carriedCount={2} closurePercent={40} onFocusRecorder={() => {}} />,
        );
        expect(screen.getByTestId('daily-loop-hero-carried')).toHaveTextContent('(यातील 2 काल पासून)');
    });

    it('hides the carried line on an empty day even if something carried over', () => {
        render(
            <DailyLoopHero pendingCount={0} carriedCount={3} closurePercent={0} onFocusRecorder={() => {}} />,
        );
        expect(screen.queryByTestId('daily-loop-hero-carried')).not.toBeInTheDocument();
    });

    it('focuses the existing recorder when tapped (no new navigation)', () => {
        const onFocus = vi.fn();
        render(
            <DailyLoopHero pendingCount={5} carriedCount={0} closurePercent={40} onFocusRecorder={onFocus} />,
        );
        fireEvent.click(screen.getByTestId('daily-loop-hero'));
        expect(onFocus).toHaveBeenCalledTimes(1);
    });
});
