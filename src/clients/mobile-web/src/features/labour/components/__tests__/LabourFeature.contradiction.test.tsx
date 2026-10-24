// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 9 (B001, spec: 2026-08-28-labour-v2-release-1) — the labour route's
 * two new honest renders:
 *
 *   1. THE PARKED QUESTION. EditSurfaceRegistry routes an
 *      AttendanceContradiction park to 'labour'; before this task nothing
 *      here rendered it — the farmer arrived at a screen with no question.
 *      Now the route renders the approved contradiction copy
 *      (एक गोष्ट स्पष्ट करा + ATTENDANCE_COPY body + reassurance) and an
 *      answer re-enqueues the mark, clearing the card.
 *
 *   2. THE OUTAGE REGISTER. A failed fetch used to render the banner and
 *      NOTHING; when the local plane holds facts, the hook now serves them
 *      and this component renders the register beside the banner instead of
 *      the dead-end.
 *
 * `useLabourState`, FarmContext and the parked module are mocked so this
 * file controls each state directly (the LabourFeature.test.tsx idiom).
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockUseLabourState = vi.fn();
vi.mock('../../useLabourState', () => ({
    useLabourState: () => mockUseLabourState(),
}));

const mockFarmContext = vi.fn();
vi.mock('../../../../core/session/FarmContext', () => ({
    useOptionalFarmContext: () => mockFarmContext(),
}));

vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: vi.fn() },
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn() },
}));

const mockListParked = vi.fn();
const mockBuildQuestion = vi.fn();
const mockAnswer = vi.fn();
vi.mock('../../data/attendanceParked', () => ({
    listParkedAttendanceContradictions: (farmId: string) => mockListParked(farmId),
    buildContradictionQuestion: (park: unknown, history: unknown) => mockBuildQuestion(park, history),
    answerAttendanceContradiction: (park: unknown, fact: unknown) => mockAnswer(park, fact),
}));

import LabourFeature from '../LabourFeature';
import { EMPTY_LABOUR_DATA } from '../../labourMock';
import { ATTENDANCE_COPY } from '../../attendanceCopy';
import type { LabourData } from '../../labour.types';

afterEach(() => {
    cleanup();
    mockUseLabourState.mockReset();
    mockFarmContext.mockReset();
    mockListParked.mockReset();
    mockBuildQuestion.mockReset();
    mockAnswer.mockReset();
});

const hookState = (over: Partial<ReturnType<typeof baseState>> = {}) => {
    mockUseLabourState.mockReturnValue({ ...baseState(), ...over });
};
const baseState = () => ({
    data: EMPTY_LABOUR_DATA as LabourData,
    loading: false,
    error: false,
    refresh: vi.fn(),
    timeWindow: 'alltime',
    setTimeWindow: vi.fn(),
    isPreview: false,
});

const PARK = {
    clientRequestId: 'req-1',
    payload: {
        attendanceMarkId: 'm-1', farmId: 'farm-1',
        fieldOperatorId: 'op-1', workDate: '2026-09-02', dayMark: 'Full' as const,
    },
};
const QUESTION = {
    name: 'गणेश',
    facts: [
        { shift: 'full' as const, labourAssignmentId: 'a-1' },
        { shift: 'night' as const, labourAssignmentId: 'a-2' },
    ],
};

const withFarm = () => mockFarmContext.mockReturnValue({ currentFarm: { farmId: 'farm-1', name: 'Farm' } });

describe('the parked contradiction question renders on the labour route', () => {
    it('asks with the approved copy and both facts as answers', async () => {
        withFarm();
        hookState();
        mockListParked.mockResolvedValue([PARK]);
        mockBuildQuestion.mockReturnValue(QUESTION);

        render(<LabourFeature onExit={vi.fn()} history={[]} />);

        await waitFor(() => expect(screen.getByTestId('attendance-contradiction')).toBeInTheDocument());
        expect(screen.getByText(ATTENDANCE_COPY.contradictionTitle)).toBeInTheDocument();
        expect(screen.getByText(ATTENDANCE_COPY.contradictionBody(
            'गणेश', ATTENDANCE_COPY.markWord.full, ATTENDANCE_COPY.markWord.night))).toBeInTheDocument();
        expect(screen.getByText(ATTENDANCE_COPY.contradictionReassurance)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: ATTENDANCE_COPY.markWord.full })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: ATTENDANCE_COPY.markWord.night })).toBeInTheDocument();
        // the question was rebuilt from THIS park and THIS history
        expect(mockBuildQuestion).toHaveBeenCalledWith(PARK, []);
    });

    it('fabricates nothing when the local rebuild cannot reproduce the question', async () => {
        withFarm();
        hookState();
        mockListParked.mockResolvedValue([PARK]);
        mockBuildQuestion.mockReturnValue(null);

        render(<LabourFeature onExit={vi.fn()} history={[]} />);

        await waitFor(() => expect(mockListParked).toHaveBeenCalled());
        expect(screen.queryByTestId('attendance-contradiction')).not.toBeInTheDocument();
    });

    it('answering sends the chosen fact and clears the card', async () => {
        withFarm();
        hookState();
        mockListParked.mockResolvedValueOnce([PARK]).mockResolvedValue([]);
        mockBuildQuestion.mockReturnValue(QUESTION);
        mockAnswer.mockResolvedValue(true);

        render(<LabourFeature onExit={vi.fn()} history={[]} />);
        await waitFor(() => expect(screen.getByTestId('attendance-contradiction')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: ATTENDANCE_COPY.markWord.night }));

        await waitFor(() => expect(mockAnswer).toHaveBeenCalledWith(
            PARK, { shift: 'night', labourAssignmentId: 'a-2' }));
        await waitFor(() =>
            expect(screen.queryByTestId('attendance-contradiction')).not.toBeInTheDocument());
    });

    it('asks for no parks without a farm (preview) — nothing to answer against', async () => {
        mockFarmContext.mockReturnValue(null);
        hookState({ isPreview: true });

        render(<LabourFeature onExit={vi.fn()} />);

        await Promise.resolve();
        expect(mockListParked).not.toHaveBeenCalled();
    });
});

describe('the outage state renders the register when local facts exist', () => {
    const offlineData: LabourData = {
        ...EMPTY_LABOUR_DATA,
        view: 'own',
        ledger: {
            weekLabel: '',
            days: ['2026-09-02'],
            rows: [{
                personId: 'op:1', fieldOperatorId: 'op-1', name: 'गणेश', initial: 'ग', tone: 'em',
                cells: [{ day: 'full', night: null, hours: null, extraHours: null, ukte: false, work: null, unsynced: true }],
            }],
            crewRows: [],
        },
    };

    it('draws the register beside the banner instead of the dead-end', async () => {
        withFarm();
        hookState({ error: true, data: offlineData });
        mockListParked.mockResolvedValue([]);

        const { container } = render(<LabourFeature onExit={vi.fn()} history={[]} />);

        expect(screen.getByText('माहिती आणता आली नाही')).toBeInTheDocument(); // the banner stays
        expect(container.querySelectorAll('[data-testid="ledger-day-head"]')).toHaveLength(1);
        expect(container.querySelector('[data-testid="ledger-cell-pending"]')).not.toBeNull();
    });

    it('keeps the dead-end when the outage has nothing local to show', async () => {
        withFarm();
        hookState({ error: true, data: EMPTY_LABOUR_DATA });
        mockListParked.mockResolvedValue([]);

        const { container } = render(<LabourFeature onExit={vi.fn()} history={[]} />);

        expect(screen.getByText('माहिती आणता आली नाही')).toBeInTheDocument();
        expect(container.querySelector('[data-testid="ledger-day-head"]')).toBeNull();
    });
});
