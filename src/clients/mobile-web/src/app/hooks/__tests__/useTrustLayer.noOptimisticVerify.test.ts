/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 *
 * spec: owner-oversight-loop — §P-D, "Acknowledgement never fakes success.
 * The tick confirms only after the write succeeds. No optimistic success."
 *
 * THE DEFECT THIS PINS
 * --------------------
 * `handleVerifyLog` used to open with a `setHistory` that wrote the
 * caller's TARGET status straight into the log, before anything had been
 * queued and long before any server had answered:
 *
 *     setHistory(prev => prev.map(log => log.id !== logId ? log : {
 *         ...log,
 *         verification: { status, ..., notes: 'Pending sync', required: true }
 *     }));
 *
 * Approving passes `LogVerificationStatus.APPROVED`, and
 * `shared/utils/dayState.ts`'s `VERIFIED_STATUSES` contains APPROVED — so
 * that one line made the record render as approved AND drop out of every
 * unverified count in the app (`isLogUnverified` -> `computeDayState` ->
 * the waiting drawer's `unverifiedCount`). The `notes: 'Pending sync'`
 * beside it changed nothing: no reader looks at `notes`.
 *
 * Against this server it was not merely premature, it was false. The
 * mutation it queued is `verify_log_v2`, and `PushSyncBatchHandler.cs`
 * answers `MUTATION_TYPE_UNIMPLEMENTED` — so the push was refused every
 * single time, permanently, while the farmer was looking at a tick.
 *
 * WHAT IS ASSERTED
 * ----------------
 * Every state this hook ever hands to `setHistory` is captured, and NONE of
 * them may show the log as verified/approved unless it came from the
 * durable store. `verifyLog` is stubbed to a promise the test releases by
 * hand, so the "while the write is in flight" window — the exact window the
 * old code lied in — is inspected directly rather than raced against.
 *
 *   verifying_writes_nothing_into_history_before_the_write_resolves
 *   verifying_only_ever_writes_what_the_durable_store_returns
 *   a_failed_enqueue_writes_nothing_into_history
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { LogVerificationStatus } from '../../../types';
import type { DailyLog, FarmerProfile } from '../../../types';

const verifyLogMock = vi.fn();
const getAllMock = vi.fn();
const triggerNowMock = vi.fn();
const auditAppendMock = vi.fn();

vi.mock('../../../application/usecases/VerifyLog', () => ({
    verifyLog: (...args: unknown[]) => verifyLogMock(...args),
}));

vi.mock('../../providers/DataSourceProvider', () => ({
    useDataSource: () => ({
        dataSource: { logs: { getAll: getAllMock } },
        auditPort: { append: auditAppendMock },
    }),
}));

vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: () => triggerNowMock() },
}));

import { useTrustLayer } from '../useTrustLayer';

function makeLog(status: LogVerificationStatus): DailyLog {
    return {
        id: 'log-1',
        date: '2026-08-20',
        context: {
            selection: [{
                cropId: 'crop-1',
                cropName: 'Grapes',
                selectedPlotIds: ['plot-1'],
                selectedPlotNames: ['Grapes A'],
            }],
        },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        meta: { createdAtISO: '2026-08-20T05:00:00.000Z', createdByOperatorId: 'op-mukadam' },
        verification: { status, required: true },
        financialSummary: {
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            totalActivityExpenses: 0,
            grandTotal: 0,
        },
    };
}

// WAVE-1.4: `resolveVerifierUserId` accepts only a SERVER-ISSUED id (a UUID) —
// `'op-owner'` is the pre-sync placeholder class it refuses, so with it here the
// hook returned at the identity guard and none of these cases ran. This is the
// id a device that has actually synced holds.
const OWNER_ID = '00000000-0000-4000-8000-00000000c0de';

const PROFILE = {
    activeOperatorId: OWNER_ID,
    operators: [{
        id: OWNER_ID,
        name: 'Owner',
        role: 'PRIMARY_OWNER',
        capabilities: [],
        isVerifier: true,
    }],
} as unknown as FarmerProfile;

/**
 * `VERIFIED_STATUSES` in `shared/utils/dayState.ts` — the set that makes
 * `isLogVerified` true, and therefore the set that a premature local write
 * must never be able to put a record into. Restated here on purpose: an
 * import would make this test agree with that module by definition, and the
 * question being asked is whether THIS hook can reach either value early.
 */
const VERIFIED_LOOKING = [LogVerificationStatus.VERIFIED, LogVerificationStatus.APPROVED];

/** Applies a `setState` update the way React would, recording every state. */
function makeHistoryRecorder(initial: DailyLog[]) {
    const states: DailyLog[][] = [];
    let current = initial;
    const setHistory = ((update: unknown) => {
        current = typeof update === 'function'
            ? (update as (prev: DailyLog[]) => DailyLog[])(current)
            : (update as DailyLog[]);
        states.push(current);
    }) as React.Dispatch<React.SetStateAction<DailyLog[]>>;
    return { states, setHistory, get current() { return current; } };
}

function mountHook(setHistory: React.Dispatch<React.SetStateAction<DailyLog[]>>) {
    return renderHook(() => useTrustLayer({
        farmerProfile: PROFILE,
        setFarmerProfile: vi.fn(),
        setHistory,
        // WAVE-1.4 made approval failures visible instead of burying them in the
        // log's farmer-facing `verification.notes`; the hook now takes a toast sink.
        setToast: vi.fn(),
        isDemoMode: false,
    }));
}

beforeEach(() => {
    verifyLogMock.mockReset();
    getAllMock.mockReset();
    triggerNowMock.mockReset();
    auditAppendMock.mockReset();
    triggerNowMock.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useTrustLayer — §P-D, no optimistic success', () => {
    it('verifying_writes_nothing_into_history_before_the_write_resolves', async () => {
        const draft = makeLog(LogVerificationStatus.DRAFT);
        const recorder = makeHistoryRecorder([draft]);

        // A promise this test releases by hand, so the in-flight window is
        // inspected rather than raced.
        let release: (value: { success: boolean }) => void = () => { };
        verifyLogMock.mockReturnValue(new Promise<{ success: boolean }>((resolve) => {
            release = resolve;
        }));
        getAllMock.mockResolvedValue([draft]);

        const { result } = mountHook(recorder.setHistory);

        let pending: unknown;
        await act(async () => {
            pending = (result.current.handleVerifyLog as unknown as
                (id: string, s: LogVerificationStatus) => Promise<void>)(
                    'log-1', LogVerificationStatus.APPROVED,
                );
        });

        // THE ASSERTION. The queue call is out; the server has said nothing.
        // Not one byte may have been written into what the farmer sees.
        expect(verifyLogMock).toHaveBeenCalledTimes(1);
        expect(recorder.states).toHaveLength(0);
        expect(recorder.current[0].verification?.status).toBe(LogVerificationStatus.DRAFT);

        await act(async () => {
            release({ success: true });
            await pending;
        });
    });

    it('verifying_only_ever_writes_what_the_durable_store_returns', async () => {
        const draft = makeLog(LogVerificationStatus.DRAFT);
        const recorder = makeHistoryRecorder([draft]);

        verifyLogMock.mockResolvedValue({ success: true });
        // The durable store is the ONLY source of a post-verify history
        // write, and here it still says DRAFT — because the server refused
        // the mutation, which is exactly what `verify_log_v2` does today.
        getAllMock.mockResolvedValue([draft]);

        const { result } = mountHook(recorder.setHistory);

        await act(async () => {
            await (result.current.handleVerifyLog as unknown as
                (id: string, s: LogVerificationStatus) => Promise<void>)(
                    'log-1', LogVerificationStatus.APPROVED,
                );
        });

        // Exactly one write, and it is the store's own answer.
        expect(getAllMock).toHaveBeenCalledTimes(1);
        expect(recorder.states).toHaveLength(1);

        for (const state of recorder.states) {
            for (const log of state) {
                expect(VERIFIED_LOOKING).not.toContain(log.verification?.status);
            }
        }
    });

    it('a_failed_enqueue_writes_nothing_into_history', async () => {
        const draft = makeLog(LogVerificationStatus.DRAFT);
        const recorder = makeHistoryRecorder([draft]);

        verifyLogMock.mockResolvedValue({ success: false, error: 'queue unavailable' });
        getAllMock.mockResolvedValue([draft]);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { });

        const { result } = mountHook(recorder.setHistory);

        await act(async () => {
            await (result.current.handleVerifyLog as unknown as
                (id: string, s: LogVerificationStatus) => Promise<void>)(
                    'log-1', LogVerificationStatus.APPROVED,
                );
        });

        // No optimistic write to roll back, and no error string smuggled
        // into the RECORD's own `verification` object either — a queue's
        // health is not a property of the farmer's log.
        //
        // WAVE-1.4 added a re-read on this branch (`restoreFromStore`), so the
        // count is no longer zero — but the RULE this test defends is unchanged
        // and is now asserted directly: every value this hook writes into
        // history is `dataSource.logs.getAll()`'s own answer, never a status
        // the device decided. A locally-invented APPROVED would fail this.
        for (const state of recorder.states) {
            expect(state).toEqual([draft]);
        }
        expect(recorder.current[0].verification?.status).toBe(LogVerificationStatus.DRAFT);
        expect(recorder.current[0].verification?.notes).toBeUndefined();
        expect(consoleError).toHaveBeenCalled();
    });
});
