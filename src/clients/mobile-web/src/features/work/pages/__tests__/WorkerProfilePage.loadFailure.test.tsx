// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TASK 8 (spec: 2026-08-28-labour-v2-release-1, P5) — the mildest of the four
 * sites, and the one whose fix is smallest.
 *
 * The worker profile ALREADY said something honest on a failed load
 * ("प्रोफाइल उपलब्ध नाही" — profile not available). What it did not do was
 * offer a way out: no retry, on a screen a farmer reaches by tapping a
 * worker's name. `P5` is not satisfied by an accurate dead end — "पुन्हा
 * प्रयत्न करा" is what turns the honest sentence into something the farmer can
 * act on, and the banner that already carries it exists (`LabourUiKit:37`).
 *
 * The companion lock: when there is NO failure — no farm scope resolved, so
 * nothing was ever asked of the server — the existing honest sentence must
 * still be what the farmer reads, with no banner and no retry offered for a
 * fetch that never happened.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockFetch = vi.fn();
const farmIdRef = { current: 'farm-1' as string | null };

vi.mock('../../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarmId: farmIdRef.current }),
}));

vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ accessToken: 'token' }),
}));

vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => fakeDb,
}));

const fakeDb = {
    workerProfiles: {
        get: async () => undefined,
        put: async () => undefined,
    },
    jobCards: {
        where: () => ({ equals: () => ({ toArray: async () => [] }) }),
    },
};

import WorkerProfilePage from '../WorkerProfilePage';

const HONEST_SENTENCE = 'प्रोफाइल उपलब्ध नाही';
const ERROR_LABEL = 'माहिती आणता आली नाही';
const RETRY_LABEL = 'पुन्हा प्रयत्न करा';

describe('WorkerProfilePage — an honest dead end still needs a way out (Task 8)', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        farmIdRef.current = 'farm-1';
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('server answers 500: offers a retry the farmer can actually press', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

        render(<WorkerProfilePage userId="worker-1" onBack={() => { }} />);

        await waitFor(() => expect(screen.getByText(RETRY_LABEL)).toBeInTheDocument());
        expect(screen.getByText(ERROR_LABEL)).toBeInTheDocument();
    });

    it('no farm scope resolved, so nothing was ever asked: keeps the honest sentence, offers no retry', async () => {
        farmIdRef.current = null;

        render(<WorkerProfilePage userId="worker-1" onBack={() => { }} />);

        await waitFor(() => expect(screen.getByText(HONEST_SENTENCE)).toBeInTheDocument());
        expect(screen.queryByText(ERROR_LABEL)).toBeNull();
        expect(screen.queryByText(RETRY_LABEL)).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
