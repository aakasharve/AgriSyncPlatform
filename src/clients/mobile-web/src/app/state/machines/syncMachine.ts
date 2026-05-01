/**
 * Sub-plan 04 Task 4 — sync actor.
 *
 * Replaces the scattered React-Context flags that today track sync status
 * across BackgroundSyncWorker, ConflictBanner, and AppHeader. The actor
 * owns four states:
 *   - idle      no work in flight; lastSyncAtMs may be set.
 *   - syncing   push or pull is running.
 *   - conflict  one or more mutations were rejected by the server and
 *               require user action via OfflineConflictPage (Task 5).
 *   - offline   navigator.onLine is false; worker is paused.
 *
 * Conflict state persists in `rejectedMutations`; resolving one removes it
 * from the list and the machine drops back to idle when the list empties.
 */
import { setup, assign } from 'xstate';

export interface RejectedMutation {
    mutationId: string;
    reason: string;
    /** Marathi-first user hint shown in OfflineConflictPage rows. */
    hint?: string;
}

export interface SyncContext {
    rejectedMutations: RejectedMutation[];
    lastSyncAtMs: number | null;
}

export type SyncEvent =
    | { type: 'TRIGGER' }
    | { type: 'SYNC_DONE'; rejected?: RejectedMutation[] }
    | { type: 'MUTATION_REJECTED'; mutationId: string; reason: string; hint?: string }
    | { type: 'CONFLICT_RESOLVED'; mutationId: string }
    | { type: 'GO_OFFLINE' }
    | { type: 'GO_ONLINE' };

export const syncMachine = setup({
    types: {} as { context: SyncContext; events: SyncEvent },
    actions: {
        appendRejection: assign({
            rejectedMutations: ({ context, event }) => {
                if (event.type !== 'MUTATION_REJECTED') return context.rejectedMutations;
                if (context.rejectedMutations.some(m => m.mutationId === event.mutationId)) {
                    return context.rejectedMutations;
                }
                return [
                    ...context.rejectedMutations,
                    { mutationId: event.mutationId, reason: event.reason, hint: event.hint },
                ];
            },
        }),
        appendBatchRejections: assign({
            rejectedMutations: ({ context, event }) => {
                if (event.type !== 'SYNC_DONE') return context.rejectedMutations;
                const incoming = event.rejected ?? [];
                if (incoming.length === 0) return context.rejectedMutations;
                const existingIds = new Set(context.rejectedMutations.map(m => m.mutationId));
                return [
                    ...context.rejectedMutations,
                    ...incoming.filter(r => !existingIds.has(r.mutationId)),
                ];
            },
        }),
        removeResolution: assign({
            rejectedMutations: ({ context, event }) => {
                if (event.type !== 'CONFLICT_RESOLVED') return context.rejectedMutations;
                return context.rejectedMutations.filter(m => m.mutationId !== event.mutationId);
            },
        }),
        stampSync: assign({ lastSyncAtMs: () => Date.now() }),
    },
    guards: {
        hasNoConflictsAfterEvent: ({ context, event }) => {
            if (event.type === 'CONFLICT_RESOLVED') {
                const remaining = context.rejectedMutations.filter(m => m.mutationId !== event.mutationId);
                return remaining.length === 0;
            }
            if (event.type === 'SYNC_DONE') {
                const incoming = event.rejected ?? [];
                if (incoming.length > 0) return false;
                return context.rejectedMutations.length === 0;
            }
            return context.rejectedMutations.length === 0;
        },
    },
}).createMachine({
    id: 'sync',
    initial: 'idle',
    context: { rejectedMutations: [], lastSyncAtMs: null },
    states: {
        idle: {
            on: {
                TRIGGER: 'syncing',
                MUTATION_REJECTED: { target: 'conflict', actions: 'appendRejection' },
                GO_OFFLINE: 'offline',
            },
        },
        syncing: {
            on: {
                SYNC_DONE: [
                    { target: 'idle', guard: 'hasNoConflictsAfterEvent', actions: ['stampSync', 'appendBatchRejections'] },
                    { target: 'conflict', actions: 'appendBatchRejections' },
                ],
                MUTATION_REJECTED: { target: 'conflict', actions: 'appendRejection' },
                GO_OFFLINE: 'offline',
            },
        },
        conflict: {
            on: {
                CONFLICT_RESOLVED: [
                    { target: 'idle', guard: 'hasNoConflictsAfterEvent', actions: 'removeResolution' },
                    { actions: 'removeResolution' },
                ],
                MUTATION_REJECTED: { actions: 'appendRejection' },
                TRIGGER: 'syncing',
                GO_OFFLINE: 'offline',
            },
        },
        offline: {
            on: { GO_ONLINE: 'idle' },
        },
    },
});
