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

describe('DailyLoopHero (Daily Clarity Loop v1 morning trigger)', () => {
    it('shows "आज N कामं बाकी" when work is left (N > 0)', () => {
        render(
            <DailyLoopHero pendingCount={5} carriedCount={0} closurePercent={40} onFocusRecorder={() => {}} />,
        );
        expect(screen.getByTestId('daily-loop-hero-line')).toHaveTextContent('आज 5 कामं बाकी');
    });

    it('shows the empty-day invite (no scolding, no count) when N === 0', () => {
        render(
            <DailyLoopHero pendingCount={0} carriedCount={0} closurePercent={100} onFocusRecorder={() => {}} />,
        );
        expect(screen.getByTestId('daily-loop-hero-line')).toHaveTextContent('आज काहीच सांगितलं नाही. काम झालं नसेल तर कारण सांगा — किंवा "आज काम नाही" एवढं सांगा.');
        expect(screen.queryByTestId('daily-loop-hero-carried')).not.toBeInTheDocument();
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
            <DailyLoopHero pendingCount={0} carriedCount={3} closurePercent={100} onFocusRecorder={() => {}} />,
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
