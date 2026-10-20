/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 *
 * `useTrustLayer` is the other place that reads the stored diary back into
 * `history` (after a verification, and to roll one back). The release 1.0.16
 * check applies there too, so no path from the store into `history` can bring
 * a dateless 1.0.14 row back onto a screen. See app/helpers/datedHistory.ts.
 *
 * Harness mirrors useTrustLayer.noOptimisticVerify.test.ts.
 *
 * spec: 2026-08-25-prod-cutover-waves (release 1.0.16)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { LogVerificationStatus } from '../../../types';
import type { DailyLog, FarmerProfile } from '../../../types';

const verifyLogMock = vi.fn();
const getAllMock = vi.fn();

vi.mock('../../../application/usecases/VerifyLog', () => ({
    verifyLog: (...args: unknown[]) => verifyLogMock(...args),
}));

vi.mock('../../providers/DataSourceProvider', () => ({
    useDataSource: () => ({
        dataSource: { logs: { getAll: getAllMock } },
        auditPort: { append: vi.fn() },
    }),
}));

vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) },
}));

import { useTrustLayer } from '../useTrustLayer';

const datedLog: DailyLog = {
    id: 'log-1',
    date: '2026-10-18',
    context: { selection: [{ cropId: 'crop-1', cropName: 'Grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['Grapes A'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    verification: { status: LogVerificationStatus.PENDING, required: true },
    financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
};

const legacyDateless = { ...datedLog, id: 'legacy-dateless-1', date: undefined } as unknown as DailyLog;

/** A server-issued id, so the hook gets past its identity guard (see the sibling suite). */
const OWNER_ID = '00000000-0000-4000-8000-00000000c0de';
const PROFILE = {
    activeOperatorId: OWNER_ID,
    operators: [{ id: OWNER_ID, name: 'Owner', role: 'PRIMARY_OWNER', capabilities: [], isVerifier: true }],
} as unknown as FarmerProfile;

async function verifyAndCapture(): Promise<DailyLog[][]> {
    const written: DailyLog[][] = [];
    const setHistory = ((update: DailyLog[]) => { written.push(update); }) as React.Dispatch<React.SetStateAction<DailyLog[]>>;
    const { result } = renderHook(() => useTrustLayer({
        farmerProfile: PROFILE,
        setFarmerProfile: vi.fn(),
        setHistory,
        setToast: vi.fn(),
        isDemoMode: false,
    }));
    await act(async () => {
        await (result.current.handleVerifyLog as unknown as
            (id: string, s: LogVerificationStatus) => Promise<void>)('log-1', LogVerificationStatus.APPROVED);
    });
    return written;
}

beforeEach(() => {
    verifyLogMock.mockReset();
    getAllMock.mockReset();
    getAllMock.mockResolvedValue([datedLog, legacyDateless]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useTrustLayer — re-reading the store never brings a dateless row back', () => {
    it('after a verification is queued, history is the store minus the dateless row', async () => {
        verifyLogMock.mockResolvedValue({ success: true });

        const written = await verifyAndCapture();

        expect(written).toHaveLength(1);
        expect(written[0].map(log => log.id)).toEqual(['log-1']);
    });

    it('when the verification could not be queued, the roll-back read leaves it out too', async () => {
        verifyLogMock.mockResolvedValue({ success: false, error: 'queue unavailable' });

        const written = await verifyAndCapture();

        expect(written).toHaveLength(1);
        expect(written[0].map(log => log.id)).toEqual(['log-1']);
    });
});
