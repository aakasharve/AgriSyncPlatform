// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourFeature tests — Decision 4b (2026-07-19, screen honesty): "a money
 * screen must never show a confident ₹0 it hasn't verified." Before this
 * fix, `LabourFeature` never read `useLabourState()`'s `loading` flag at
 * all, so a real farm's FIRST fetch (in flight) rendered the hub with
 * `EMPTY_LABOUR_DATA` — a confident-looking "0 पेंडिंग"/empty state — instead
 * of an honest loading indicator.
 *
 * Extended Task 6d (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8)
 * — Decision 4b stopped at NUMBERS. The whole-branch review found the same
 * gate also let a failed fetch render `EMPTY_LABOUR_DATA` as full hub
 * content beneath the error banner, i.e. a false SENTENCE ("अजून कोणी
 * कामगार जोडलेला नाही" — no worker added yet) to a farmer whose data simply
 * didn't load. No nullable field can fix a sentence; only withholding it
 * can. The second `describe` block below covers that render-gate change;
 * the first is adjusted only where Task 6d's `loading`-only spinner gate
 * changed its expectations (see the inline note there).
 *
 * `useLabourState` and `useOptionalFarmContext` are both mocked so this test
 * can control `loading`/`error` directly across re-renders, independent of
 * the real fetch hook's own (separately-tested) behaviour.
 *
 * Task 12 (spec: 2026-08-28-labour-v2-release-1) — every mock below also
 * returns `timeWindow`/`setTimeWindow`, added when Task 12's now-superseded
 * reset effect called `setTimeWindow` unconditionally on every mount (an
 * incomplete mock threw). TASK 17 (R14 superseded) removed that effect —
 * `LabourFeature` no longer calls `setTimeWindow` on mount at all — but the
 * fields stay: they match `useLabourState`'s real return shape, and these
 * tests never open आढावा (the only screen that reads them), so they remain
 * otherwise irrelevant to this file's loading/error assertions.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockUseLabourState = vi.fn();
vi.mock('../../useLabourState', () => ({
    useLabourState: () => mockUseLabourState(),
}));

vi.mock('../../../../core/session/FarmContext', () => ({
    useOptionalFarmContext: () => null, // no real farm to invite into — irrelevant to this test
}));

// LabourFeature always mounts ReviewSheet (open just toggles visibility), so
// these need mocking here too — mirrors reviewApprove.test.ts's setup.
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: vi.fn() },
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn() },
}));

import LabourFeature from '../LabourFeature';
import { EMPTY_LABOUR_DATA, EMPTY_WEEK_LABOUR_DATA } from '../../labourMock';

const LOADING_LABEL = 'माहिती आणत आहोत…';
const EMPTY_PEOPLE_LABEL = 'अजून कोणी कामगार जोडलेला नाही';
const ERROR_LABEL = 'माहिती आणता आली नाही';
const RETRY_LABEL = 'पुन्हा प्रयत्न करा';

describe('LabourFeature — loading gate (Decision 4b; extended Task 6d)', () => {
    afterEach(() => {
        cleanup();
        mockUseLabourState.mockReset();
    });

    it('shows a loading state instead of the hub while the FIRST fetch is in flight', () => {
        mockUseLabourState.mockReturnValue({ data: EMPTY_LABOUR_DATA, loading: true, error: false, refresh: vi.fn(), timeWindow: 'alltime', setTimeWindow: vi.fn() });

        render(<LabourFeature onExit={() => {}} />);

        expect(screen.getByText(LOADING_LABEL)).toBeInTheDocument();
        // Never a confident empty/zero hub while still fetching.
        expect(screen.queryByText(EMPTY_PEOPLE_LABEL)).toBeNull();
    });

    it('shows the real hub once the first fetch settles', () => {
        mockUseLabourState.mockReturnValue({ data: EMPTY_LABOUR_DATA, loading: false, error: false, refresh: vi.fn(), timeWindow: 'alltime', setTimeWindow: vi.fn() });

        render(<LabourFeature onExit={() => {}} />);

        expect(screen.queryByText(LOADING_LABEL)).toBeNull();
        expect(screen.getByText(EMPTY_PEOPLE_LABEL)).toBeInTheDocument();
    });

    // TASK 6d (2026-08-28) — this used to assert the OPPOSITE: that a later
    // refresh must NOT re-show the spinner, so the screen stayed "loaded"
    // in place. That was wrong. `useLabourState.ts:135` resets `data` to
    // `EMPTY_LABOUR_DATA` before EVERY fetch, not just the first, so
    // "staying loaded" actually meant the hub sat over fabricated zeros for
    // the length of every background refresh — the exact flash-of-false-
    // zeros bug this task exists to remove. The spinner now gates on
    // `loading` alone: a later refresh shows the SAME honest spinner the
    // first load does, never the hub over data it just discarded.
    it('a later background refresh (loading true again) re-shows the loading state — never the hub over fabricated zeros', () => {
        mockUseLabourState.mockReturnValue({ data: EMPTY_LABOUR_DATA, loading: false, error: false, refresh: vi.fn(), timeWindow: 'alltime', setTimeWindow: vi.fn() });
        const { rerender } = render(<LabourFeature onExit={() => {}} />);
        expect(screen.getByText(EMPTY_PEOPLE_LABEL)).toBeInTheDocument();

        // Simulate ReviewSheet's onApproved -> refresh() cycle.
        mockUseLabourState.mockReturnValue({ data: EMPTY_LABOUR_DATA, loading: true, error: false, refresh: vi.fn(), timeWindow: 'alltime', setTimeWindow: vi.fn() });
        rerender(<LabourFeature onExit={() => {}} />);

        expect(screen.getByText(LOADING_LABEL)).toBeInTheDocument();
        expect(screen.queryByText(EMPTY_PEOPLE_LABEL)).toBeNull();
    });
});

// TASK 6d (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) —
// finishes the outage state. A failed fetch used to fall through to the
// SAME content switch a success uses, rendering the hub over
// `EMPTY_LABOUR_DATA` beneath the error banner: "अजून कोणी कामगार जोडलेला
// नाही" (no worker has been added yet) to a farmer whose fetch simply
// failed — possibly someone with twelve real workers and forty logs. That
// is a false SENTENCE, not a false number; Task 6c's nullable fields
// (`EMPTY_LABOUR_DATA`'s five numeric zeros -> unknown) could not touch it.
describe('LabourFeature — error state asserts nothing (Task 6d)', () => {
    afterEach(() => {
        cleanup();
        mockUseLabourState.mockReset();
    });

    it('on a failed fetch: shows ONLY the error banner — no "no workers" sentence, no नोंदी tile, no hub content at all', () => {
        mockUseLabourState.mockReturnValue({ data: EMPTY_LABOUR_DATA, loading: false, error: true, refresh: vi.fn(), timeWindow: 'alltime', setTimeWindow: vi.fn() });

        render(<LabourFeature onExit={() => {}} />);

        expect(screen.getByText(ERROR_LABEL)).toBeInTheDocument();
        expect(screen.getByText(RETRY_LABEL)).toBeInTheDocument();
        // The false sentence itself — the exact thing Task 6c's nullable
        // numbers could not reach.
        expect(screen.queryByText(EMPTY_PEOPLE_LABEL)).toBeNull();
        // A "नोंदी" tile only ever comes from WeeklyDashboard, which (like
        // every other screen — mukadam/person/attendance/ledger) is
        // unreachable here because the WHOLE content switch is withheld on
        // `error`, not merely the default hub screen.
        expect(screen.queryByText('नोंदी')).toBeNull();
    });

    // Step 4 (the brief's own words) — "the companion test that stops the
    // fix from over-reaching." Suppression must be keyed on `error` alone,
    // never on "the data looks empty" — conflating the two would replace
    // one lie with another (Ruling R8: absence of any record ⇒ unknown; a
    // record that exists and contains nothing ⇒ a genuine, honest zero).
    // `error: false` here is exactly what a REAL successful fetch for a
    // farm with zero workers returns — the message must still be true.
    it('on a SUCCESSFUL fetch for a genuinely empty farm: still shows the true empty-state message, never the error banner', () => {
        mockUseLabourState.mockReturnValue({ data: EMPTY_LABOUR_DATA, loading: false, error: false, refresh: vi.fn(), timeWindow: 'alltime', setTimeWindow: vi.fn() });

        render(<LabourFeature onExit={() => {}} />);

        expect(screen.getByText(EMPTY_PEOPLE_LABEL)).toBeInTheDocument();
        expect(screen.queryByText(ERROR_LABEL)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Task 18 (spec: 2026-08-28-labour-v2-release-1) — `useLabourState`'s
// `isPreview` must reach `LabourHub` unchanged, so the founder-review
// exception for हजेरी घ्या (LabourHub's SHOW_ATTENDANCE_TILE) actually works
// end-to-end through THIS component's own wiring, not just inside LabourHub's
// isolated tests. (The हजेरी वही tile left this exception with Correction 5:
// its switch was deleted, so it renders for real farms and preview alike.)
// ---------------------------------------------------------------------------

describe('LabourFeature — threads isPreview to LabourHub (Task 18)', () => {
    afterEach(() => {
        cleanup();
        mockUseLabourState.mockReset();
    });

    it('reveals हजेरी घ्या / हजेरी वही when the hook reports isPreview: true', () => {
        mockUseLabourState.mockReturnValue({ data: EMPTY_LABOUR_DATA, loading: false, error: false, refresh: vi.fn(), timeWindow: 'alltime', setTimeWindow: vi.fn(), isPreview: true });

        render(<LabourFeature onExit={() => {}} />);

        expect(screen.getByText('हजेरी घ्या')).toBeInTheDocument();
        expect(screen.getByText('हजेरी वही')).toBeInTheDocument();
    });

    it('keeps हजेरी घ्या hidden when the hook reports isPreview: false — the हजेरी वही stays (Correction 5)', () => {
        mockUseLabourState.mockReturnValue({ data: EMPTY_LABOUR_DATA, loading: false, error: false, refresh: vi.fn(), timeWindow: 'alltime', setTimeWindow: vi.fn(), isPreview: false });

        render(<LabourFeature onExit={() => {}} />);

        expect(screen.queryByText('हजेरी घ्या')).toBeNull();
        expect(screen.getByText('हजेरी वही')).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// Correction 5 fix round (Task 4.5 review) — the REAL-ROUTE click-through
// pin. The mount tests in HajeriLedgerTotals.test.tsx prove the tile exists
// with no flag and no preview escape; THIS test proves the door OPENS:
// through LabourFeature's real screen stack, on the realistic zero-marks
// wire (`EMPTY_WEEK_LABOUR_DATA` — the backend-guaranteed blank 7-day week,
// GetLabourDataHandler.cs:852-857), tapping हजेरी वही renders the register
// itself. Blank cells, never zero — and the empty-claim card is correct
// here because this IS the owner view (F1: any other view's empty rows are
// withheld by projection, and the card must not render).
// ---------------------------------------------------------------------------
describe('LabourFeature — the हजेरी वही door opens on a zero-marks farm (Correction 5)', () => {
    afterEach(() => {
        cleanup();
        mockUseLabourState.mockReset();
    });

    it('tapping the tile walks the real route into an empty register: 7 day heads, 0 rows, the owner claim card', () => {
        mockUseLabourState.mockReturnValue({ data: EMPTY_WEEK_LABOUR_DATA, loading: false, error: false, refresh: vi.fn(), timeWindow: 'alltime', setTimeWindow: vi.fn(), isPreview: false });

        const { container } = render(<LabourFeature onExit={() => {}} />);

        fireEvent.click(screen.getByText('हजेरी वही'));

        // The always-drawn grid: every day of the blank week has a head…
        expect(container.querySelectorAll('[data-testid="ledger-day-head"]').length).toBe(7);
        // …and no row of any kind (person or crew) exists to hang a mark on.
        expect(container.querySelectorAll('[data-testid="ledger-row"]').length).toBe(0);
        // Owner view, genuinely empty record → the claim card is TRUE (F1).
        expect(screen.getByText('अजून हजेरी नोंदवली नाही')).toBeInTheDocument();
    });
});
