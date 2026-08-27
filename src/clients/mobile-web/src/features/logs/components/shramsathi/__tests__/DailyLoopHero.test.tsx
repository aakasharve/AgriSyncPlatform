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
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { t as translate } from '../../../../../i18n/translations';
// Ruling A2 (founder review of `?preview=oversight`, 2026-08-26) — the settled
// line is now gated on what the oversight strip is saying, published by
// `AppHeader`. This suite renders the hero ALONE, with no header in the tree,
// so the signal is whatever these tests publish. The default is deliberately
// left at `null` ("the strip is making no claim") — see
// `the_settled_line_is_never_spoken_from_silence` below, which is the unit-level
// half of the guard; the wiring itself is proven end-to-end against the real
// header in `features/oversight/__tests__/oversightWaitingSignal.test.tsx`.
import {
    publishOversightWaitingSignal,
    resetOversightWaitingSignal,
} from '../../../../oversight/oversightWaitingSignal';
import DailyLoopHero from '../DailyLoopHero';

vi.mock('../../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'mr',
        setLanguage: () => {},
        t: (key: string) => translate(key, 'mr'),
    }),
}));

beforeEach(() => {
    resetOversightWaitingSignal();
});

afterEach(() => {
    cleanup();
    resetOversightWaitingSignal();
});

/** Publishes what the oversight strip is saying, then renders — the same
 * order production has it in (the header commits, the hero reads). */
function renderWithStripSaying(signal: number | null, element: React.ReactElement) {
    act(() => {
        publishOversightWaitingSignal(signal);
    });
    return render(element);
}

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

    // Ruling A2 added the second precondition: the strip must ALSO be saying
    // nothing is waiting. `0` here is that state (its rest tick).
    it('never claims "you told me nothing" once the day HAS been recorded (N === 0, closure > 0)', () => {
        renderWithStripSaying(
            0,
            <DailyLoopHero pendingCount={0} carriedCount={0} closurePercent={100} onFocusRecorder={() => {}} />,
        );
        const line = screen.getByTestId('daily-loop-hero-line');
        // The exact contradiction Wave 2.4 exists to kill: a full ring beside
        // "आज काहीच सांगितलं नाही" ("you told me nothing today").
        expect(line).not.toHaveTextContent('आज काहीच सांगितलं नाही');
        expect(line).toHaveTextContent('आज सगळं सांगून झालं — काही बाकी नाही.');
        expect(screen.getByTestId('daily-loop-hero-ring')).toHaveTextContent('100%');
    });

    // ---- Ruling A2: "काही बाकी नाही" is a claim, and a claim needs evidence --

    it('the_settled_line_is_never_spoken_over_a_positive_waiting_count', () => {
        renderWithStripSaying(
            4,
            <DailyLoopHero pendingCount={0} carriedCount={0} closurePercent={100} onFocusRecorder={() => {}} />,
        );
        expect(screen.queryByText('आज सगळं सांगून झालं — काही बाकी नाही.')).toBeNull();
        expect(screen.queryByTestId('daily-loop-hero')).toBeNull();
    });

    it('the_settled_line_is_never_spoken_from_silence (no strip on screen = no claim)', () => {
        // `null` is the module default and means "the strip is making no count
        // claim". Reading it as zero is the exact unknown-reported-as-none
        // failure this gate exists to prevent, so the hero says nothing.
        renderWithStripSaying(
            null,
            <DailyLoopHero pendingCount={0} carriedCount={0} closurePercent={100} onFocusRecorder={() => {}} />,
        );
        expect(screen.queryByText('आज सगळं सांगून झालं — काही बाकी नाही.')).toBeNull();
        expect(screen.queryByTestId('daily-loop-hero')).toBeNull();
    });

    it('a positive waiting count leaves the OTHER two states untouched', () => {
        // Gating these would be hiding true lines to fake agreement. "N tasks
        // left" and "nothing told yet" both sit happily beside a waiting strip.
        renderWithStripSaying(
            4,
            <DailyLoopHero pendingCount={5} carriedCount={0} closurePercent={40} onFocusRecorder={() => {}} />,
        );
        expect(screen.getByTestId('daily-loop-hero-line')).toHaveTextContent('आज 5 कामं बाकी');
        cleanup();

        renderWithStripSaying(
            4,
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
