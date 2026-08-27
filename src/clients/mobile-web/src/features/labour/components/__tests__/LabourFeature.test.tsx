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
 * `useLabourState` and `useOptionalFarmContext` are both mocked so this test
 * can control `loading` directly across re-renders, independent of the real
 * fetch hook's own (separately-tested) behaviour.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
import { EMPTY_LABOUR_DATA } from '../../labourMock';

const LOADING_LABEL = 'माहिती आणत आहोत…';
const EMPTY_PEOPLE_LABEL = 'अजून कोणी कामगार जोडलेला नाही';

describe('LabourFeature — loading gate (Decision 4b)', () => {
    afterEach(() => {
        cleanup();
        mockUseLabourState.mockReset();
    });

    it('shows a loading state instead of the hub while the FIRST fetch is in flight', () => {
        mockUseLabourState.mockReturnValue({ data: EMPTY_LABOUR_DATA, loading: true, error: false, refresh: vi.fn() });

        render(<LabourFeature onExit={() => {}} />);

        expect(screen.getByText(LOADING_LABEL)).toBeInTheDocument();
        // Never a confident empty/zero hub while still fetching.
        expect(screen.queryByText(EMPTY_PEOPLE_LABEL)).toBeNull();
    });

    it('shows the real hub once the first fetch settles', () => {
        mockUseLabourState.mockReturnValue({ data: EMPTY_LABOUR_DATA, loading: false, error: false, refresh: vi.fn() });

        render(<LabourFeature onExit={() => {}} />);

        expect(screen.queryByText(LOADING_LABEL)).toBeNull();
        expect(screen.getByText(EMPTY_PEOPLE_LABEL)).toBeInTheDocument();
    });

    it('a later background refresh (loading true again) does NOT blank the already-loaded screen', () => {
        mockUseLabourState.mockReturnValue({ data: EMPTY_LABOUR_DATA, loading: false, error: false, refresh: vi.fn() });
        const { rerender } = render(<LabourFeature onExit={() => {}} />);
        expect(screen.getByText(EMPTY_PEOPLE_LABEL)).toBeInTheDocument();

        // Simulate ReviewSheet's onApproved -> refresh() cycle: loading flips
        // true again while data is momentarily reset — this must NOT re-show
        // the full-screen loading gate now that the feature has loaded once.
        mockUseLabourState.mockReturnValue({ data: EMPTY_LABOUR_DATA, loading: true, error: false, refresh: vi.fn() });
        rerender(<LabourFeature onExit={() => {}} />);

        expect(screen.queryByText(LOADING_LABEL)).toBeNull();
    });
});
