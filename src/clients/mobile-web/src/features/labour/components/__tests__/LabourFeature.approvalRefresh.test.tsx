// @vitest-environment jsdom
/**
 * spec: plr-d10 (I28, lane L4b fix round 1, review L-8) — after a मंजूर in the one review sheet, the हजेरी page reads its
 * own data again (its day marks and statuses), as it did when the sheet lived inside it. Another farm's मंजूर does not.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('../../useLabourState', async () => {
    const { EMPTY_LABOUR_DATA } = await import('../../labourMock');
    return {
        useLabourState: () => ({
            data: EMPTY_LABOUR_DATA, loading: false, error: false, refresh: h.refresh,
            timeWindow: 'alltime', setTimeWindow: vi.fn(), isPreview: false, staleSinceIso: null,
        }),
    };
});
vi.mock('../../../../core/session/FarmContext', () => ({
    useOptionalFarmContext: () => ({ currentFarm: { farmId: 'farm-1', name: 'Farm' }, currentFarmId: 'farm-1' }),
}));
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({ VerifyLogCommand: { enqueue: vi.fn() } }));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));
vi.mock('../../data/attendanceParked', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../data/attendanceParked')>();
    return {
        ...actual,
        listParkedAttendanceContradictions: async () => [],
        listAnsweredDaysToRule: async () => new Set<string>(),
    };
});

import LabourFeature from '../LabourFeature';
import { notifyApprovalSent } from '../../../approval/approvalQueue';

afterEach(() => { cleanup(); h.refresh.mockReset(); });

describe('the हजेरी page after a मंजूर', () => {
    it('reads its own data again after a decision on its farm, not after another farm\'s', async () => {
        render(<LabourFeature onExit={vi.fn()} history={[]} />);
        h.refresh.mockClear();
        await act(async () => { notifyApprovalSent('farm-2'); });
        expect(h.refresh).not.toHaveBeenCalled();
        await act(async () => { notifyApprovalSent('farm-1'); });
        expect(h.refresh).toHaveBeenCalledTimes(1);
    });
});
