// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DayUnderstandingCard — a day the farmer HONESTLY DECLARED as no-work.
 * spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (Task 6).
 *
 * Founder ruling 2 (2026-08-14): "Reward honesty and mark its consistency — no
 * score needed for such days." Showing a 0 to a farmer who told us the truth
 * ("today there was no work") punishes the very honesty the product is built to
 * earn. So on a `DeclaredNoWorkDay` this card shows NO number at all — not a 0,
 * not a band, not a bar — and acknowledges his consistency instead.
 *
 * The classification is the SERVER's stored value (DailyRichnessAggregate
 * .DayClassification, persisted as a string) arriving on the day-understanding
 * DTO. It is NEVER computed here — the server is the authority on what kind of
 * day it was (P4/P8).
 *
 * Follows the vi.doMock + vi.resetModules + dynamic-import pattern used across
 * the DFES suite for toggling FEATURE_FLAGS without leaking module state.
 */
import React from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { t as translate } from '../../../../../i18n/translations';

const dayUnderstandingMock = vi.fn();
const farmerEngagementMock = vi.fn();

async function loadComponent(understandingMeter: boolean) {
    vi.resetModules();
    vi.doMock('../../../../../app/featureFlags', () => ({
        FEATURE_FLAGS: {
            understandingMeter,
            disciplineSystem: false,
            spokenUnlockReward: false,
            DwcChip: false,
        },
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isEnabled: () => understandingMeter,
    }));
    vi.doMock('../../../hooks/useDayUnderstanding', () => ({
        useDayUnderstanding: (...args: unknown[]) => dayUnderstandingMock(...args),
    }));
    vi.doMock('../../../hooks/useFarmerEngagement', () => ({
        useFarmerEngagement: (...args: unknown[]) => farmerEngagementMock(...args),
    }));
    vi.doMock('../../../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => translate(k, 'mr') }),
    }));
    return import('../DayUnderstandingCard');
}

/** The server's stored day-understanding read for the day under test. */
function mockDay(score: number | null, classification: string | null, refresh = vi.fn()) {
    dayUnderstandingMock.mockReturnValue({
        score, classification, isLoading: false, error: null, refresh,
    });
}

/** The server-folded engagement projection; `null` = not loaded / offline. */
function mockStreak(currentStreak: number | null) {
    farmerEngagementMock.mockReturnValue({
        engagement: currentStreak === null ? null : {
            currentStreak,
            longestStreak: currentStreak,
            totalShramPoints: 0,
            lastAccountedDate: null,
            totalRichDays: 0,
            unlockStatus: 'locked' as const,
        },
        isLoading: false,
        error: null,
        refresh: vi.fn(),
    });
}

beforeEach(() => {
    dayUnderstandingMock.mockReset();
    farmerEngagementMock.mockReset();
    mockDay(null, null);
    mockStreak(null);
});

afterEach(() => {
    cleanup();
    vi.doUnmock('../../../../../app/featureFlags');
    vi.doUnmock('../../../hooks/useDayUnderstanding');
    vi.doUnmock('../../../hooks/useFarmerEngagement');
    vi.doUnmock('../../../../../i18n/LanguageContext');
    vi.resetModules();
});

describe('DayUnderstandingCard — a declared no-work day (founder ruling 2, 2026-08-14)', () => {
    it('shows consistency instead of a number when the farmer honestly declared no work', async () => {
        mockDay(0, 'DeclaredNoWorkDay');
        mockStreak(6);
        const { DayUnderstandingCard } = await loadComponent(true);

        const { getByTestId, queryByTestId } = render(
            <DayUnderstandingCard farmId="farm-1" dayDate="2026-08-14" />,
        );

        expect(queryByTestId('day-understanding-value')).toBeNull();
        expect(getByTestId('day-understanding-nowork').textContent)
            .toBe('आज काम नाही — तुम्ही सांगितलं, मी नोंदवलं.');
        expect(getByTestId('day-understanding-consistency').textContent)
            .toBe('सलग ६ दिवस तुम्ही न चुकता सांगताय.');
    });

    it('still shows the number on an ordinary work day', async () => {
        mockDay(6, 'BasicWorkDay');
        const { DayUnderstandingCard } = await loadComponent(true);

        const { getByTestId, queryByTestId } = render(
            <DayUnderstandingCard farmId="farm-1" dayDate="2026-08-14" />,
        );

        expect(getByTestId('day-understanding-value').textContent).toBe('६ / १०');
        expect(queryByTestId('day-understanding-nowork')).toBeNull();
    });

    it('shows NO number of any kind on a no-work day — not a 0, not a band, not the bar', async () => {
        mockDay(0, 'DeclaredNoWorkDay');
        mockStreak(6);
        const { DayUnderstandingCard } = await loadComponent(true);

        const { container, queryByTestId } = render(
            <DayUnderstandingCard farmId="farm-1" dayDate="2026-08-14" />,
        );

        expect(queryByTestId('day-understanding-band')).toBeNull();
        expect(queryByTestId('day-understanding-target')).toBeNull();
        expect(queryByTestId('understanding-bar')).toBeNull();
        // Neither a Devanagari nor an ASCII zero-out-of-ten anywhere on the surface.
        expect(container.textContent ?? '').not.toMatch(/०\s*\/\s*१०/);
        expect(container.textContent ?? '').not.toMatch(/0\s*\/\s*10/);
    });

    it('omits the consistency line rather than inventing a streak when engagement has not loaded', async () => {
        mockDay(0, 'DeclaredNoWorkDay');
        mockStreak(null); // offline / not yet fetched
        const { DayUnderstandingCard } = await loadComponent(true);

        const { getByTestId, queryByTestId } = render(
            <DayUnderstandingCard farmId="farm-1" dayDate="2026-08-14" />,
        );

        expect(getByTestId('day-understanding-nowork')).toBeTruthy();
        expect(queryByTestId('day-understanding-consistency')).toBeNull();
    });

    it('omits the consistency line on a zero streak rather than claiming "० दिवस"', async () => {
        mockDay(0, 'DeclaredNoWorkDay');
        mockStreak(0);
        const { DayUnderstandingCard } = await loadComponent(true);

        const { queryByTestId } = render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-08-14" />);

        expect(queryByTestId('day-understanding-consistency')).toBeNull();
    });

    it('does not fetch the engagement projection on an ordinary day', async () => {
        mockDay(6, 'BasicWorkDay');
        const { DayUnderstandingCard } = await loadComponent(true);

        render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-08-14" />);

        // useFarmerEngagement short-circuits on a falsy farmId, so passing null is
        // how the ordinary success screen stays on exactly the network calls it
        // made before this change.
        expect(farmerEngagementMock).toHaveBeenCalledWith(null);
    });

    it('fetches the engagement projection for the active farm on a no-work day', async () => {
        mockDay(0, 'DeclaredNoWorkDay');
        mockStreak(6);
        const { DayUnderstandingCard } = await loadComponent(true);

        render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-08-14" />);

        expect(farmerEngagementMock).toHaveBeenCalledWith('farm-1');
    });

    it('renders nothing on a no-work day while the understandingMeter flag is OFF', async () => {
        mockDay(0, 'DeclaredNoWorkDay');
        mockStreak(6);
        const { DayUnderstandingCard } = await loadComponent(false);

        const { container } = render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-08-14" />);

        expect(container.firstChild).toBeNull();
    });

    // HAZARD guard (Task 4's subscription effect). The no-work early return must sit
    // BELOW that useEffect — a hook after a conditional return is a rules-of-hooks
    // violation, and the card would silently stop refreshing on this render path.
    it('still refreshes on a recorded DFES answer while showing the no-work state', async () => {
        const refresh = vi.fn();
        mockDay(0, 'DeclaredNoWorkDay', refresh);
        mockStreak(6);
        const { DayUnderstandingCard } = await loadComponent(true);
        const { notifyDfesAnswered } = await import('../../../services/dfesAnswerSignal');

        render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-08-14" />);
        expect(refresh).not.toHaveBeenCalled();

        await act(async () => { notifyDfesAnswered(); });

        expect(refresh).toHaveBeenCalledTimes(1);
    });
});
