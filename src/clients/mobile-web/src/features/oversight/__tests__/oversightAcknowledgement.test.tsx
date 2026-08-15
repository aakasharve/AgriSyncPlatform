// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Task 2 — pins the acknowledgement checkpoint's two binding behaviours:
 *
 *  1. `LocalOversightAcknowledgementStore` persists per (userId, farmId),
 *     through the app's namespaced `storageNamespace.getKey()` — never a
 *     bare localStorage key (see the module's own doc comment for why that
 *     matters: per-farmer isolation is a live P0 in another lane).
 *     `a_second_farmer_on_the_same_handset_cannot_read_the_first_farmers_checkpoint`
 *     is the mutation-proof guard: it fails if `${currentUserId()}` is ever
 *     dropped from the key, which none of the other three tests would catch
 *     (they never vary the active user).
 *  2. `useOversightAcknowledgement` never fakes success (spec §P-D): a
 *     rejected `acknowledge()` sets `status: 'failed'` and leaves
 *     `checkpointISO` untouched. Never optimistic, never a silent queue.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

import { LocalOversightAcknowledgementStore } from '../LocalOversightAcknowledgementStore';
import { useOversightAcknowledgement } from '../useOversightAcknowledgement';
import { DemoModeStore } from '../../../infrastructure/storage/DemoModeStore';
import type { OversightAcknowledgementPort } from '../OversightAcknowledgementPort';

beforeEach(() => {
    localStorage.clear();
    DemoModeStore.setActiveUserId('owner-oversight-test-user');
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('LocalOversightAcknowledgementStore', () => {
    it('acknowledge_persists_the_checkpoint_for_that_farm', async () => {
        await expect(LocalOversightAcknowledgementStore.read('farm-a')).resolves.toBeNull();

        await LocalOversightAcknowledgementStore.acknowledge('farm-a', '2026-08-10T00:00:00.000Z');

        await expect(LocalOversightAcknowledgementStore.read('farm-a')).resolves.toBe(
            '2026-08-10T00:00:00.000Z',
        );
    });

    it('checkpoints_are_scoped_per_farm', async () => {
        await LocalOversightAcknowledgementStore.acknowledge('farm-a', '2026-08-10T00:00:00.000Z');

        // farm-a advanced; a DIFFERENT farm for the SAME user must stay
        // untouched — the checkpoint is per-farm, not a single global flag.
        await expect(LocalOversightAcknowledgementStore.read('farm-a')).resolves.toBe(
            '2026-08-10T00:00:00.000Z',
        );
        await expect(LocalOversightAcknowledgementStore.read('farm-b')).resolves.toBeNull();
    });

    it('a_second_farmer_on_the_same_handset_cannot_read_the_first_farmers_checkpoint', async () => {
        // Farmer A acknowledges on THIS farm.
        DemoModeStore.setActiveUserId('farmer-a');
        await LocalOversightAcknowledgementStore.acknowledge('farm-shared', '2026-08-10T00:00:00.000Z');
        await expect(LocalOversightAcknowledgementStore.read('farm-shared')).resolves.toBe(
            '2026-08-10T00:00:00.000Z',
        );

        // Same handset, farmer B signs in. Same farmId — MUST see no checkpoint,
        // not farmer A's. This is the exact P0 (shared-handset leak) the
        // (userId, farmId) key exists to close.
        DemoModeStore.setActiveUserId('farmer-b');
        await expect(LocalOversightAcknowledgementStore.read('farm-shared')).resolves.toBeNull();

        // Switching back to A must recover A's value untouched — isolation
        // must not have corrupted or dropped it.
        DemoModeStore.setActiveUserId('farmer-a');
        await expect(LocalOversightAcknowledgementStore.read('farm-shared')).resolves.toBe(
            '2026-08-10T00:00:00.000Z',
        );
    });
});

describe('useOversightAcknowledgement', () => {
    it('a_failed_acknowledge_leaves_the_previous_checkpoint_untouched', async () => {
        let shouldFail = false;
        const port: OversightAcknowledgementPort = {
            read: async () => null,
            acknowledge: async (_farmId, _atISO) => {
                if (shouldFail) {
                    throw new Error('simulated backend rejection');
                }
            },
        };

        const { result } = renderHook(() => useOversightAcknowledgement('farm-a', port));

        // First acknowledge succeeds — establishes a real, non-null checkpoint.
        await act(async () => {
            await result.current.acknowledge('2026-08-10T00:00:00.000Z');
        });
        expect(result.current.checkpointISO).toBe('2026-08-10T00:00:00.000Z');
        expect(result.current.status).toBe('idle');

        // Second acknowledge is REJECTED by the port.
        shouldFail = true;
        await act(async () => {
            await result.current.acknowledge('2026-08-12T00:00:00.000Z');
        });

        // Spec §P-D: the checkpoint must stay exactly where the last SUCCESSFUL
        // write left it — never the rejected value, never null.
        expect(result.current.checkpointISO).toBe('2026-08-10T00:00:00.000Z');
    });

    it('a_failed_acknowledge_reports_failed_status', async () => {
        const port: OversightAcknowledgementPort = {
            read: async () => null,
            acknowledge: async () => {
                throw new Error('simulated backend rejection');
            },
        };

        const { result } = renderHook(() => useOversightAcknowledgement('farm-a', port));

        await act(async () => {
            await result.current.acknowledge('2026-08-10T00:00:00.000Z');
        });

        expect(result.current.status).toBe('failed');
    });
});
