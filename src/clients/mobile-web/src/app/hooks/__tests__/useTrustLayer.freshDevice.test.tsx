// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WAVE-1.4 fix round, finding I1 (spec: dfes-companion-2026-07-11).
 *
 * The task-1.4 client fix made `VerifyLog.ts` emit the canonical
 * `verify_log_v2` shape, and its test proved that — but the fixture handed it
 * a hand-made GUID operator id. A farmer's fresh device never has one:
 * `createInitialFarmerProfile()` sets `activeOperatorId` to the LITERAL STRING
 * `'owner'`. `useTrustLayer` passed that straight through as the wire's
 * `verifierUserId`, `ZGuid` rejected it, `mutationQueue.enqueue` threw, and the
 * hook swallowed the error into the farmer-facing `verification.notes` while
 * reverting the row. The approve button did nothing, silently, on day one.
 *
 * These tests drive the REAL hook with the REAL day-one profile (imported from
 * `useAppData`, not copied — a copy can drift and stop reproducing day one) and
 * a REAL `MutationQueue` over fake-indexeddb. Nothing about payload
 * construction or validation is mocked; the queued row is parsed with the
 * REAL `VerifyLogV2Payload` schema.
 */
import 'fake-indexeddb/auto';
import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const triggerNow = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: {
        triggerNow: (...args: unknown[]) => triggerNow(...args),
        start: vi.fn(),
        stop: vi.fn(),
    },
}));

const logsGetAll = vi.fn();
const auditAppend = vi.fn().mockResolvedValue(undefined);
vi.mock('../../providers/DataSourceProvider', () => ({
    useDataSource: () => ({
        dataSource: { logs: { getAll: (...args: unknown[]) => logsGetAll(...args) } },
        auditPort: { append: (...args: unknown[]) => auditAppend(...args) },
        isDemoMode: false,
        setDemoMode: vi.fn(),
        isLoading: false,
    }),
}));

import { useTrustLayer } from '../useTrustLayer';
import { createInitialFarmerProfile } from '../useAppData';
import { DailyLog, FarmerProfile, LogVerificationStatus } from '../../../types';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { setAuthSession, clearAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { VerifyLogV2Payload } from '../../../../../../../sync-contract/schemas/payloads';

const SESSION_USER_ID = 'd4d4d4d4-0000-4000-8000-000000000004';
const SERVER_OPERATOR_ID = 'e5e5e5e5-0000-4000-8000-000000000005';
const LOG_ID = 'f6f6f6f6-0000-4000-8000-000000000006';

function mukadamsDraftLog(): DailyLog {
    return {
        id: LOG_ID,
        meta: { createdByOperatorId: 'some-mukadam' },
        verification: {
            status: LogVerificationStatus.DRAFT,
            required: true,
        },
    } as unknown as DailyLog;
}

type ToastState = { message: string; type: 'success' | 'error' } | null;

/**
 * Drives the hook exactly as `compositionRoot` does: real React state for the
 * profile, the history and the toast.
 */
function useHarness(initialProfile: FarmerProfile) {
    const [farmerProfile, setFarmerProfile] = useState<FarmerProfile>(initialProfile);
    const [history, setHistory] = useState<DailyLog[]>([mukadamsDraftLog()]);
    const [toast, setToast] = useState<ToastState>(null);

    const trust = useTrustLayer({
        farmerProfile,
        setFarmerProfile,
        setHistory,
        setToast,
        isDemoMode: false,
    });

    return { trust, history, toast };
}

async function freshDb(): Promise<void> {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // first run — nothing to delete
    }
    await resetDatabase();
}

async function queuedRows() {
    return getDatabase().mutationQueue.toArray();
}

describe('useTrustLayer — approving on a device that has never synced (I1)', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        triggerNow.mockResolvedValue(undefined);
        auditAppend.mockResolvedValue(undefined);
        await freshDb();
        clearAuthSession();
        // The durable store still holds the un-approved log: the client never
        // owns the verification status, so a re-read is what a rollback means.
        logsGetAll.mockResolvedValue([mukadamsDraftLog()]);
        setAuthSession({
            userId: SESSION_USER_ID,
            accessToken: 'test-access-token',
            expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
        });
    });

    afterEach(() => {
        clearAuthSession();
    });

    it('queues a VALID verify_log_v2 mutation even though activeOperatorId is the literal "owner"', async () => {
        const dayOne = createInitialFarmerProfile();
        // Guard: if this ever stops being the placeholder, the test below stops
        // reproducing day one and must be re-derived rather than trusted.
        expect(dayOne.activeOperatorId).toBe('owner');

        const { result } = renderHook(() => useHarness(dayOne));

        await act(async () => {
            await result.current.trust.handleVerifyLog(LOG_ID, LogVerificationStatus.APPROVED);
        });

        const rows = await queuedRows();
        expect(rows).toHaveLength(1);

        const parsed = VerifyLogV2Payload.safeParse(rows[0].payload);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.logId).toBe(LOG_ID);
            expect(parsed.data.decision).toBe('verify');
            // The placeholder is never put on the wire; the signed-in user is.
            expect(parsed.data.verifierUserId).toBe(SESSION_USER_ID);
        }

        expect(result.current.toast?.type).toBe('success');
    });

    it('never buries a Zod/validation error in the farmer-facing verification notes', async () => {
        const { result } = renderHook(() => useHarness(createInitialFarmerProfile()));

        await act(async () => {
            await result.current.trust.handleVerifyLog(LOG_ID, LogVerificationStatus.APPROVED);
        });

        const notes = result.current.history[0]?.verification?.notes ?? '';
        expect(notes).not.toMatch(/Payload validation failed/i);
        expect(notes).not.toMatch(/verifierUserId/i);
    });

    it('a dispute from the same fresh device also reaches the queue, with its reason', async () => {
        const { result } = renderHook(() => useHarness(createInitialFarmerProfile()));

        await act(async () => {
            await result.current.trust.handleVerifyLog(
                LOG_ID,
                LogVerificationStatus.DISPUTED,
                'quantity looks wrong'
            );
        });

        const rows = await queuedRows();
        expect(rows).toHaveLength(1);
        const parsed = VerifyLogV2Payload.safeParse(rows[0].payload);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.decision).toBe('dispute');
            expect(parsed.data.reason).toBe('quantity looks wrong');
        }
    });
});

describe('useTrustLayer — a synced device still credits its own operator id', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        triggerNow.mockResolvedValue(undefined);
        await freshDb();
        clearAuthSession();
        logsGetAll.mockResolvedValue([mukadamsDraftLog()]);
        setAuthSession({
            userId: SESSION_USER_ID,
            accessToken: 'test-access-token',
            expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
        });
    });

    afterEach(() => {
        clearAuthSession();
    });

    it('uses the server-issued activeOperatorId, not the session id, once one exists', async () => {
        const synced: FarmerProfile = {
            ...createInitialFarmerProfile(),
            activeOperatorId: SERVER_OPERATOR_ID,
        };
        const { result } = renderHook(() => useHarness(synced));

        await act(async () => {
            await result.current.trust.handleVerifyLog(LOG_ID, LogVerificationStatus.APPROVED);
        });

        const rows = await queuedRows();
        expect(rows).toHaveLength(1);
        const parsed = VerifyLogV2Payload.safeParse(rows[0].payload);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.verifierUserId).toBe(SERVER_OPERATOR_ID);
        }
    });
});

describe('useTrustLayer — no identity at all: block loudly, do not pretend', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await freshDb();
        clearAuthSession();
        logsGetAll.mockResolvedValue([mukadamsDraftLog()]);
    });

    it('raises a visible error, queues nothing, and leaves the row untouched', async () => {
        const { result } = renderHook(() => useHarness(createInitialFarmerProfile()));

        await act(async () => {
            await result.current.trust.handleVerifyLog(LOG_ID, LogVerificationStatus.APPROVED);
        });

        expect(await queuedRows()).toHaveLength(0);
        expect(result.current.toast?.type).toBe('error');
        expect(result.current.toast?.message ?? '').not.toHaveLength(0);

        // No optimistic paint was applied, so the farmer is not shown an
        // approval that is about to be taken back.
        expect(result.current.history[0]?.verification?.status).toBe(LogVerificationStatus.DRAFT);
        expect(result.current.history[0]?.verification?.notes).toBeUndefined();
    });
});

describe('useTrustLayer — a genuine queue failure is surfaced, not swallowed', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        triggerNow.mockResolvedValue(undefined);
        await freshDb();
        clearAuthSession();
        logsGetAll.mockResolvedValue([mukadamsDraftLog()]);
        setAuthSession({
            userId: SESSION_USER_ID,
            accessToken: 'test-access-token',
            expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
        });
    });

    afterEach(() => {
        clearAuthSession();
    });

    it('an unqueueable log id shows an error toast and reverts from the durable store', async () => {
        const { result } = renderHook(() => useHarness(createInitialFarmerProfile()));

        // A non-UUID log id is rejected by the same canonical schema — the
        // remaining realistic way `enqueue` can still throw.
        await act(async () => {
            await result.current.trust.handleVerifyLog('not-a-uuid', LogVerificationStatus.APPROVED);
        });

        expect(await queuedRows()).toHaveLength(0);
        expect(result.current.toast?.type).toBe('error');
        expect(logsGetAll).toHaveBeenCalled();
    });
});
