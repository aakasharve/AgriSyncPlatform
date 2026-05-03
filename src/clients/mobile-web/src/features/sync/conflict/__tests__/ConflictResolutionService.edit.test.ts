// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * T-IGH-04-CONFLICT-EDIT — locks the contract between
 * `ConflictResolutionService.edit(mutationId)` and the
 * `EditSurfaceRegistry`.
 *
 * The DoD says: Vitest coverage MUST assert that calling
 * `ConflictResolutionService.edit('m1')` invokes the routed-to surface
 * with the seeded payload. We do that here (not in OfflineConflictPage's
 * test) because the page test mocks the service entirely.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ConflictResolutionService } from '../ConflictResolutionService';
import {
    registerEditSurface,
    _resetEditSurfaceRegistry,
    EDIT_MUTATION_EVENT,
    type EditMutationEventDetail,
} from '../EditSurfaceRegistry';
import { mutationQueue } from '../../../../infrastructure/sync/MutationQueue';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

async function seedRejectedRow(mutationType: string, payload: unknown, clientRequestId: string) {
    const db = getDatabase();
    await db.mutationQueue.add({
        deviceId: mutationQueue.getDeviceId(),
        clientRequestId,
        clientCommandId: clientRequestId,
        mutationType,
        payload,
        status: 'REJECTED_USER_REVIEW',
        createdAt: '2026-04-01T10:00:00.000Z',
        updatedAt: '2026-04-01T10:00:00.000Z',
        retryCount: 1,
        lastError: 'INVALID_PAYLOAD',
    });
}

describe('ConflictResolutionService.edit — registry hand-off', () => {
    beforeEach(async () => {
        await freshDb();
        _resetEditSurfaceRegistry();
    });

    it('invokes the registered edit surface with the seeded payload', async () => {
        const handler = vi.fn();
        registerEditSurface(SyncMutationName.AddCostEntry, handler);

        const seededPayload = { amount: 1234, description: 'fertilizer' };
        await seedRejectedRow(SyncMutationName.AddCostEntry, seededPayload, 'm1');

        await ConflictResolutionService.edit('m1');

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({
            mutationId: 'm1',
            mutationType: SyncMutationName.AddCostEntry,
            payload: seededPayload,
        });
    });

    it('falls back to the escalate sentinel when no surface is registered', async () => {
        // Override the default registration with the same sentinel + a spy
        // wrapper so we can assert the fall-through path.
        const spyEvent = vi.fn<(e: Event) => void>();
        window.addEventListener(EDIT_MUTATION_EVENT, spyEvent as EventListener);
        const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});

        // VerifyLogV2 is registered to escalateToOwner by default, which
        // dispatches a CustomEvent with route === 'escalate'.
        await seedRejectedRow(SyncMutationName.VerifyLogV2, { logId: 'l9' }, 'm-escalate');

        await ConflictResolutionService.edit('m-escalate');

        const matchingCall = spyEvent.mock.calls.find(([evt]) => {
            const detail = (evt as CustomEvent<EditMutationEventDetail>).detail;
            return detail?.mutationId === 'm-escalate';
        });
        expect(matchingCall).toBeDefined();
        const detail = (matchingCall![0] as CustomEvent<EditMutationEventDetail>).detail;
        expect(detail.route).toBe('escalate');
        expect(detail.payload).toEqual({ logId: 'l9' });

        expect(alertMock).toHaveBeenCalled();

        window.removeEventListener(EDIT_MUTATION_EVENT, spyEvent as EventListener);
        alertMock.mockRestore();
    });

    it('is a no-op when no row matches the mutationId', async () => {
        const handler = vi.fn();
        registerEditSurface(SyncMutationName.CreateDailyLog, handler);

        await ConflictResolutionService.edit('does-not-exist');

        expect(handler).not.toHaveBeenCalled();
    });
});
