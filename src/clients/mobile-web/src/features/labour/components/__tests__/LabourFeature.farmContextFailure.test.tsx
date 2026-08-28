// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TASK 6e (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) — the
 * SECOND DOOR to the false sentence Task 6d closed.
 *
 * Task 6d proved the labour screen withholds "अजून कोणी कामगार जोडलेला नाही"
 * (no worker has been added yet) when `useLabourState` reports `error`. It
 * did that with `useLabourState` mocked. This file deliberately does NOT
 * mock the hook: it drives the REAL `useLabourState` from a REAL-shaped
 * `FarmContext` value, so it proves the whole chain end-to-end —
 *
 *     /me fails  ->  FarmContext.loadFailed  ->  useLabourState.error
 *                ->  LabourFeature withholds the claim, shows the banner.
 *
 * Before Task 6e that chain was broken at its first link: `FarmContext`
 * swallowed the `/me` failure silently and then cleared `isLoading`, so a
 * fresh install (no cached `currentFarmId`) settled at "no farm" with no
 * failure visible to anyone. The hub then stated, as fact, that a farmer
 * who may have twelve workers has none — on exactly the weak rural signal a
 * field pilot runs under.
 *
 * The second test is the anti-over-reach lock, and it matters as much as
 * the first: a SUCCESSFUL `/me` for an account that genuinely has zero
 * farms is a real answer, and the empty-state sentence is TRUE there. The
 * gate is `loadFailed`, never "farmId happens to be null".
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockUseOptionalFarmContext = vi.fn();
vi.mock('../../../../core/session/FarmContext', () => ({
    useOptionalFarmContext: () => mockUseOptionalFarmContext(),
}));

// No AuthProvider in this tree — the hook's auth gate opens rather than
// deadlocking on a provider that will never appear (see useLabourState.ts).
vi.mock('../../../../app/providers/AuthProvider', () => ({
    useOptionalAuth: () => null,
}));

// Must never be reached in either case below (there is no farm id to fetch
// for); mocked so a regression that fires it fails loudly instead of hitting
// the network.
const mockFetchLabourData = vi.fn();
vi.mock('../../data/labourClient', () => ({
    fetchLabourData: (farmId: string) => mockFetchLabourData(farmId),
}));

// LabourFeature always mounts ReviewSheet (open just toggles visibility), so
// these need mocking here too — mirrors LabourFeature.test.tsx's setup.
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: vi.fn() },
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn() },
}));

import LabourFeature from '../LabourFeature';

const EMPTY_PEOPLE_LABEL = 'अजून कोणी कामगार जोडलेला नाही';
const ERROR_LABEL = 'माहिती आणता आली नाही';
const RETRY_LABEL = 'पुन्हा प्रयत्न करा';

describe('LabourFeature — "could not find out which farm" is not "has no workers" (Task 6e)', () => {
    afterEach(() => {
        cleanup();
        mockUseOptionalFarmContext.mockReset();
        mockFetchLabourData.mockReset();
    });

    it('fresh install, /me failed, no farm resolved: shows the error banner and retry — never the "no workers" sentence', async () => {
        mockUseOptionalFarmContext.mockReturnValue({
            currentFarmId: null, currentFarm: null, isLoading: false, loadFailed: true,
        });

        render(<LabourFeature onExit={() => {}} />);

        await waitFor(() => expect(screen.getByText(ERROR_LABEL)).toBeInTheDocument());
        expect(screen.getByText(RETRY_LABEL)).toBeInTheDocument();
        // The falsehood itself.
        expect(screen.queryByText(EMPTY_PEOPLE_LABEL)).toBeNull();
        expect(mockFetchLabourData).not.toHaveBeenCalled();
    });

    it('/me SUCCEEDED and the account genuinely has zero farms: still shows the true empty-state message, no banner', () => {
        mockUseOptionalFarmContext.mockReturnValue({
            currentFarmId: null, currentFarm: null, isLoading: false, loadFailed: false,
        });

        render(<LabourFeature onExit={() => {}} />);

        expect(screen.getByText(EMPTY_PEOPLE_LABEL)).toBeInTheDocument();
        expect(screen.queryByText(ERROR_LABEL)).toBeNull();
        expect(mockFetchLabourData).not.toHaveBeenCalled();
    });
});
