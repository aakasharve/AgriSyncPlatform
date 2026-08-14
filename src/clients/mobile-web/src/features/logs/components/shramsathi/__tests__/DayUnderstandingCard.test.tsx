// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DayUnderstandingCard — unit tests (spec: dfes-companion-2026-07-11).
 *
 * These assertions MOVED here verbatim from MeterDisplay.test.tsx when the score
 * block was lifted out of MeterDisplay (founder request 2026-07-19) so the Day
 * Understanding Score can lead the post-save success surface. The contract is
 * unchanged:
 *   - flag OFF        → renders nothing (inert + network-silent in production),
 *   - score present   → "X / १०" in Devanagari, under the Sathi framing line,
 *   - score null      → NO number, a gentle Marathi pending state,
 *   - fetch fail/offline → NO number, gentle pending — and NEVER the client /100,
 *   - the 3 internal lenses are never rendered (client only ever sees the /10),
 *   - this component is the SINGLE owner of the useDayUnderstanding fetch, and it
 *     passes (farmId, dayDate, savedLogId) straight through to it.
 *
 * Follows the vi.doMock + vi.resetModules + dynamic-import pattern used across
 * the DFES suite for toggling FEATURE_FLAGS without leaking module state.
 */
import React from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { t as translate } from '../../../../../i18n/translations';

// Controllable useDayUnderstanding mock — set per test.
const dayUnderstandingMock = vi.fn();

/**
 * Load DayUnderstandingCard with FEATURE_FLAGS.understandingMeter forced, the
 * server Day-Understanding hook mocked, and useLanguage bound to the REAL Marathi
 * translations (so the framing/pending copy assertions are meaningful).
 */
async function loadComponent(understandingMeter: boolean) {
    vi.resetModules();
    vi.doMock('../../../../../app/featureFlags', () => ({
        FEATURE_FLAGS: {
            understandingMeter,
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
    vi.doMock('../../../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => translate(k, 'mr') }),
    }));
    return import('../DayUnderstandingCard');
}

function mockDayScore(score: number | null, error: string | null = null) {
    dayUnderstandingMock.mockReturnValue({ score, isLoading: false, error, refresh: vi.fn() });
}

beforeEach(() => {
    dayUnderstandingMock.mockReset();
    mockDayScore(null);
});

afterEach(() => {
    cleanup();
    vi.doUnmock('../../../../../app/featureFlags');
    vi.doUnmock('../../../hooks/useDayUnderstanding');
    vi.doUnmock('../../../../../i18n/LanguageContext');
    vi.resetModules();
});

// =============================================================================
// TESTS
// =============================================================================

describe('DayUnderstandingCard (server /10 Day Understanding Score)', () => {
    // -------------------------------------------------------------------------
    // 1. Flag OFF → renders nothing
    // -------------------------------------------------------------------------
    it('renders nothing when FEATURE_FLAGS.understandingMeter is OFF', async () => {
        mockDayScore(9);
        const { DayUnderstandingCard } = await loadComponent(false);
        const { container } = render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" />);
        expect(container.firstChild).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 2. Score present → "X / १०" in Devanagari + framing line + the bar
    // -------------------------------------------------------------------------
    it('shows the server score as "X / १०" with the Marathi framing line', async () => {
        mockDayScore(8);
        const { DayUnderstandingCard } = await loadComponent(true);

        const { getByTestId } = render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" />);

        expect(getByTestId('day-understanding-value').textContent).toBe('८ / १०');
        // Framing = Sathi's understanding of the day, not a grade of the farmer.
        // REDESIGN 2026-08-13 — `day-understanding-intro` is gone (the framing line
        // is now the SurfaceSection eyebrow "मला किती समजलं" that wraps this card in
        // mainView), and the compaction pass merged the target line and the
        // how-to-move-it line into ONE row: `day-understanding-target`. Asserting
        // that row keeps the real guarantee — the score is never an unlabelled bare
        // number, and the farmer is always told what he is chasing.
        const targetLine = getByTestId('day-understanding-target').textContent ?? '';
        expect(targetLine).toContain('समज');   // "…तेवढं मला समजतं" — how to move it
        expect(targetLine).toContain('९');     // the mark he is chasing
        // The founder-approved bar renders under the number.
        expect(getByTestId('understanding-bar')).toBeTruthy();
        // The bar now also announces the chase target (2026-08-13), so the label
        // is '8 / 10, target 8'. Assert the score is present rather than pinning the
        // whole string — the score reaching the reader is the real guarantee.
        expect(getByTestId('understanding-bar').getAttribute('aria-label')).toContain('8 / 10');
    });

    // -------------------------------------------------------------------------
    // 3. Score null → NO number, gentle pending, no /100 anywhere
    // -------------------------------------------------------------------------
    it('shows a gentle pending state (NO number) when the server score is null', async () => {
        mockDayScore(null);
        const { DayUnderstandingCard } = await loadComponent(true);

        const { getByTestId, queryByTestId, container } = render(
            <DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" />,
        );

        expect(getByTestId('day-understanding-pending').textContent).toBe('अजून समजतंय…');
        expect(queryByTestId('day-understanding-value')).toBeNull();
        // never a 0, never a client /100
        expect(container.textContent).not.toContain('/100');
        expect(container.textContent).not.toMatch(/०\s*\/\s*१०/);
    });

    // -------------------------------------------------------------------------
    // 4. Fetch failed/offline → NO number, pending — NOT the client scoreVlog /100
    // -------------------------------------------------------------------------
    it('on a failed/offline fetch shows pending and NEVER the client /100 fallback', async () => {
        mockDayScore(null, 'offline'); // hook already collapsed the error to score null
        const { DayUnderstandingCard } = await loadComponent(true);

        const { getByTestId, queryByTestId, container } = render(
            <DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" />,
        );

        expect(getByTestId('day-understanding-pending')).toBeTruthy();
        expect(queryByTestId('day-understanding-value')).toBeNull();
        expect(container.textContent).not.toContain('/100');
        expect(container.textContent).not.toContain('78');
    });

    // -------------------------------------------------------------------------
    // 5. The 3 internal lenses are never rendered — only the /10 surfaces
    // -------------------------------------------------------------------------
    it('never renders the internal lenses — only the single /10 score', async () => {
        mockDayScore(7);
        const { DayUnderstandingCard } = await loadComponent(true);

        const { getByTestId } = render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" />);

        // Scoped to the score element: the surface now also carries the chase
        // target ("८ पर्यंत पोहोचायचंय"), which is a legitimate second numeral. The
        // guarantee under test is that the three internal LENS scores never surface,
        // so assert on the number block itself.
        const value = getByTestId('day-understanding-value');
        const digits = (value.textContent ?? '').match(/[०-९]+/g) ?? [];
        expect(digits).toEqual(['७', '१०']);

        // ...and no lens score (0-100) leaks anywhere on the surface.
        const surface = getByTestId('day-understanding');
        expect(surface.textContent ?? '').not.toMatch(/(4[0-9]|[5-9][0-9]|100)/);
    });

    // -------------------------------------------------------------------------
    // 6. This component owns the fetch. farmId/dayDate go straight in; the third
    //    argument is a COMPOSITE refetch key.
    //
    //    BUGFIX_2026-08-12: it used to be savedLogId alone (BUGFIX_2026-07-19),
    //    and the score never appeared at all. "Saved to Ledger" fires on the LOCAL
    //    Dexie write, but the log only reaches the server on the next
    //    BackgroundSyncWorker tick (~15 s). The savedLogId-keyed fetch therefore
    //    ran while the server had no such log, got null, and NOTHING re-ran it —
    //    savedLogId/farmId/dayDate are all unchanged by the sync that follows.
    //    Verified against a live server holding {"score":7} while the card stayed
    //    on "अजून समजतंय…". The key now also carries syncMachine's lastSyncAtMs,
    //    so a completed sync triggers exactly one more fetch (no polling loop).
    // -------------------------------------------------------------------------
    it('passes farmId, dayDate and a refetch key carrying savedLogId into useDayUnderstanding', async () => {
        mockDayScore(6);
        const { DayUnderstandingCard } = await loadComponent(true);

        render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" savedLogId="log-42" />);

        const [farmArg, dateArg, refreshKey] = dayUnderstandingMock.mock.calls.at(-1) as [
            string | null, string | undefined, string,
        ];
        expect(farmArg).toBe('farm-1');
        expect(dateArg).toBe('2026-07-11');
        expect(refreshKey).toContain('log-42');
    });

    it('changes the refetch key when a sync completes, so a late-arriving log is picked up', async () => {
        mockDayScore(null);
        const { DayUnderstandingCard } = await loadComponent(true);
        const { getRootStore } = await import('../../../../../app/state/RootStore');

        const { rerender } = render(<DayUnderstandingCard farmId="farm-1" savedLogId="log-42" />);
        const keyBeforeSync = (dayUnderstandingMock.mock.calls.at(-1) as unknown[])[2];

        // The real signal BackgroundSyncWorker emits once a push round-trips.
        await act(async () => {
            getRootStore().sync.send({ type: 'TRIGGER' });
            getRootStore().sync.send({ type: 'SYNC_DONE' });
        });
        rerender(<DayUnderstandingCard farmId="farm-1" savedLogId="log-42" />);

        const keyAfterSync = (dayUnderstandingMock.mock.calls.at(-1) as unknown[])[2];
        expect(keyAfterSync).not.toBe(keyBeforeSync);
    });

    it('normalises a missing farm to null rather than skipping the hook call', async () => {
        mockDayScore(null);
        const { DayUnderstandingCard } = await loadComponent(true);

        render(<DayUnderstandingCard farmId={null} />);

        const [farmArg, dateArg] = dayUnderstandingMock.mock.calls.at(-1) as [string | null, string | undefined];
        expect(farmArg).toBeNull();
        expect(dateArg).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    // 7. Task 4 (spec: dfes-farmer-facing-deploy-readiness-2026-08-14) —
    //    refetch after a DFES gap question is answered. Founder ruling A: "the
    //    number he is looking at must reflect it before he looks away."
    //    MeterQuestionHost (a SIBLING of this card under mainView's success
    //    surface) calls notifyDfesAnswered() once the server has accepted an
    //    answer; this card must call its OWN useDayUnderstanding refresh() in
    //    response — not wait for the next sync tick or a new saved log.
    // -------------------------------------------------------------------------
    it('calls useDayUnderstanding\'s refresh when notified that a DFES answer was recorded', async () => {
        const refresh = vi.fn();
        dayUnderstandingMock.mockReturnValue({ score: 6, isLoading: false, error: null, refresh });
        const { DayUnderstandingCard } = await loadComponent(true);
        const { notifyDfesAnswered } = await import('../../../services/dfesAnswerSignal');

        render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" />);
        expect(refresh).not.toHaveBeenCalled();

        await act(async () => { notifyDfesAnswered(); });

        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('stops listening once unmounted, so a later answer on another screen cannot call a stale refresh', async () => {
        const refresh = vi.fn();
        dayUnderstandingMock.mockReturnValue({ score: 6, isLoading: false, error: null, refresh });
        const { DayUnderstandingCard } = await loadComponent(true);
        const { notifyDfesAnswered } = await import('../../../services/dfesAnswerSignal');

        const { unmount } = render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" />);
        unmount();

        await act(async () => { notifyDfesAnswered(); });

        expect(refresh).not.toHaveBeenCalled();
    });
});
