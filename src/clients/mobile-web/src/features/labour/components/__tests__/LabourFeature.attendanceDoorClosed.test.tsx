// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE ATTENDANCE-CAPTURE DOOR IS SHUT FOR A REAL FARM — the real-mount pin.
 * spec: 2026-08-28-labour-v2-release-1
 *
 * Three controls behind that door are KNOWN UNFINISHED and are tracked in
 * `docs/superpowers/plans/precision/followup-manual-attendance-door.md`:
 *   1. the save reads "जतन करा → मंजुरीसाठी" though no approval step rides an
 *      attendance mark;
 *   2. the "आज किती लोक आली?" counter collects a number `onSave` discards;
 *   3. "नाव जोडा" only toasts.
 * They are not merge blockers BECAUSE they are unreachable. This file is what
 * makes "unreachable" a fact the gate can check rather than a claim in a
 * comment. Un-hiding the door means FINISHING those three first (Decision 4b).
 *
 * WHY THIS FILE EXISTS WHEN THREE PINS ALREADY MENTION हजेरी घ्या.
 * `LabourHub.test.tsx` (Task 18 block) hands `LabourHub` an `isPreview` prop
 * directly, and `LabourFeature.test.tsx` mocks `useLabourState` and returns
 * `isPreview` from the mock. Both assert the LAST link of the chain. Neither
 * can fail if the DERIVATION breaks — if `isPreview` ever stopped meaning
 * "no farm context at all", every one of them would stay green while a real
 * farmer got the door. So this file mocks nothing on that path: the REAL
 * `FarmContextProvider` (fed a real-shaped `/me`), the REAL `useLabourState`,
 * the REAL `LabourHub` and its `SHOW_ATTENDANCE_TILE`. Only the network and
 * device storage below the feature are stubbed.
 *
 * The second test is what gives the first one teeth: same file, same stubs,
 * provider REMOVED — the tile appears. So test 1's absence is caused by the
 * closed door, not by a hub that failed to render. Flip
 * `SHOW_ATTENDANCE_TILE` to `true` and test 1 fails.
 *
 * The third test walks the other doors off the hub (हजेरी वही, आढावा, तपासा)
 * and proves none of them lands on the capture screen — the runtime echo of
 * the static trace: `LabourFeature.tsx` pushes `{ name: 'attendance' }` from
 * exactly ONE place, `LabourHub`'s gated tile.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ── Below the feature: the network and the device. Nothing on the door's
// own path is mocked here. ───────────────────────────────────────────────
const mockFetchMeContext = vi.fn();
vi.mock('../../../../core/session/MeContextService', () => ({
    fetchMeContext: (opts?: { force?: boolean }) => mockFetchMeContext(opts),
    invalidateMeContext: vi.fn(),
}));

// `useAuth` is what `FarmContextProvider` gates its /me fetch on;
// `useOptionalAuth` is `useLabourState`'s own gate. A real farmer on this
// screen is signed in with a token in memory, so both say so.
vi.mock('../../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ isAuthenticated: true }),
    useOptionalAuth: () => ({ authStatus: 'authenticated', session: { accessToken: 'test-token' } }),
}));

const mockFetchLabourData = vi.fn();
vi.mock('../../data/labourClient', () => ({
    fetchLabourData: (farmId: string, timeWindow: string) => mockFetchLabourData(farmId, timeWindow),
}));

vi.mock('../../data/attendanceLocal', () => ({
    getLocalAttendanceMarks: () => Promise.resolve([]),
    getLocalAttendanceNameHints: () => Promise.resolve(new Map()),
}));

vi.mock('../../data/attendanceParked', () => ({
    listParkedAttendanceContradictions: () => Promise.resolve([]),
    buildContradictionQuestion: () => null,
    answerAttendanceContradiction: vi.fn(),
}));

// LabourFeature always mounts ReviewSheet (open just toggles visibility), so
// these need mocking here too — mirrors LabourFeature.test.tsx's setup.
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: vi.fn() },
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn() },
}));

import { FarmContextProvider } from '../../../../core/session/FarmContext';
import LabourFeature from '../LabourFeature';
import { LABOUR_MOCK } from '../../labourMock';

/** The capture tile — the ONE door into the unfinished screen. */
const CAPTURE_TILE = 'हजेरी घ्या';
/** Rendered by the हजेरी वही tile, which Correction 5 un-gated for every farm. */
const LEDGER_TILE = 'हजेरी वही';
/** `TITLES.attendance` — the header the capture screen would carry. */
const CAPTURE_SCREEN_TITLE = 'आजची हजेरी';

/** The three unfinished controls, verbatim from `Attendance.tsx`. */
const UNFINISHED_CONTROLS = [
    'आज किती लोक आली?',
    'नाव जोडा — इतिहासातून किंवा नवीन',
    'जतन करा → मंजुरीसाठी',
];

const expectDoorShut = () => {
    expect(screen.queryByText(CAPTURE_TILE)).toBeNull();
    expect(screen.queryByText(CAPTURE_SCREEN_TITLE)).toBeNull();
    UNFINISHED_CONTROLS.forEach((copy) => expect(screen.queryByText(copy)).toBeNull());
};

const REAL_FARM = {
    farmId: 'f1a2b3c4-0000-4000-8000-000000000001',
    name: 'पुरवेश यांची शेती',
    farmCode: null,
    ownerAccountId: '00000000-0000-0000-0000-0000000000c2',
    role: 'Owner',
    status: 'Active',
    joinedVia: 'created',
    plan: 'Free' as const,
    planValidUntilUtc: null,
    capabilities: { canInvite: true, canVerify: true, canAddCost: true, canSeeBilling: true },
};

const ME_CONTEXT = {
    me: {
        userId: 'u1', displayName: 'पुरवेश', phoneMasked: '88****8888',
        phoneVerifiedAtUtc: null, preferredLanguage: 'mr', authMode: 'otp',
    },
    farms: [REAL_FARM],
    share: { referralCode: null, referralsTotal: 0, referralsQualified: 0, benefitsEarned: 0 },
    alerts: [],
    serverTimeUtc: '2026-09-03T06:00:00Z',
};

/**
 * A REAL farm mount: the actual provider resolves an actual farm from an
 * actual-shaped `/me`, and the wire answers with a FULLY POPULATED farm
 * (`LABOUR_MOCK`'s shape, workers and all). Populated on purpose — a tile
 * missing from an empty screen proves nothing.
 */
const renderRealFarm = () => render(
    <FarmContextProvider>
        <LabourFeature onExit={() => {}} history={[]} lastLabourLogIds={[]} />
    </FarmContextProvider>,
);

afterEach(() => {
    cleanup();
    mockFetchMeContext.mockReset();
    mockFetchLabourData.mockReset();
    window.localStorage.clear();
});

describe('Labour route — the attendance-capture door is shut for a real farm', () => {
    it('a real farm, fully loaded: no capture tile, no capture screen, none of its three unfinished controls', async () => {
        mockFetchMeContext.mockResolvedValue(ME_CONTEXT);
        mockFetchLabourData.mockResolvedValue(LABOUR_MOCK);

        renderRealFarm();

        // Positive control FIRST: the hub really rendered, with the doors a
        // farmer IS allowed through. Without this, the assertions below would
        // also pass against a blank screen.
        await waitFor(() => expect(screen.getByText(LEDGER_TILE)).toBeInTheDocument());
        expect(screen.getByText('तपासा')).toBeInTheDocument();
        expect(screen.getByText('आढावा')).toBeInTheDocument();
        expect(mockFetchLabourData).toHaveBeenCalledWith(REAL_FARM.farmId, 'alltime');

        expectDoorShut();
    });

    it('teeth: with NO farm context at all (the ?preview=labour mount) the same tree DOES show the tile', async () => {
        // No provider => useOptionalFarmContext() === null => isPreview.
        // This is the founder-review escape, and it is the only one.
        render(<LabourFeature onExit={() => {}} />);

        await waitFor(() => expect(screen.getByText(CAPTURE_TILE)).toBeInTheDocument());
        // The preview never reaches the wire — it renders the mock instead.
        expect(mockFetchLabourData).not.toHaveBeenCalled();
    });

    it('the other doors off the hub never land on the capture screen', async () => {
        mockFetchMeContext.mockResolvedValue(ME_CONTEXT);
        mockFetchLabourData.mockResolvedValue(LABOUR_MOCK);

        for (const door of [LEDGER_TILE, 'आढावा', 'तपासा']) {
            renderRealFarm();
            await waitFor(() => expect(screen.getByText(LEDGER_TILE)).toBeInTheDocument());

            fireEvent.click(screen.getByText(door));

            expectDoorShut();
            cleanup();
        }
    });
});
