/**
 * Sub-plan 04 Task 4 — syncMachine state graph.
 *
 * Locks the sync actor's transitions: idle → syncing → (idle | conflict |
 * offline). The conflict state holds an ordered list of rejected mutations
 * the OfflineConflictPage will display in Task 5.
 */
import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { syncMachine } from '../syncMachine';

describe('syncMachine', () => {
    it('starts in idle with no rejected mutations', () => {
        const actor = createActor(syncMachine).start();
        const snap = actor.getSnapshot();
        expect(snap.value).toBe('idle');
        expect(snap.context.rejectedMutations).toEqual([]);
        expect(snap.context.lastSyncAtMs).toBeNull();
    });

    it('transitions idle → syncing on TRIGGER', () => {
        const actor = createActor(syncMachine).start();
        actor.send({ type: 'TRIGGER' });
        expect(actor.getSnapshot().value).toBe('syncing');
    });

    it('records a rejection and enters conflict from syncing', () => {
        const actor = createActor(syncMachine).start();
        actor.send({ type: 'TRIGGER' });
        actor.send({
            type: 'MUTATION_REJECTED',
            mutationId: 'm1',
            reason: 'CLIENT_TOO_OLD',
            hint: 'अॅप अपडेट करा',
        });

        const snap = actor.getSnapshot();
        expect(snap.value).toBe('conflict');
        expect(snap.context.rejectedMutations).toHaveLength(1);
        expect(snap.context.rejectedMutations[0]).toEqual({
            mutationId: 'm1',
            reason: 'CLIENT_TOO_OLD',
            hint: 'अॅप अपडेट करा',
        });
    });

    it('records a rejection from idle without losing state', () => {
        const actor = createActor(syncMachine).start();
        actor.send({ type: 'MUTATION_REJECTED', mutationId: 'm2', reason: 'X' });
        expect(actor.getSnapshot().value).toBe('conflict');
        expect(actor.getSnapshot().context.rejectedMutations).toHaveLength(1);
    });

    it('returns to idle when the last conflict resolves and stamps last-sync', () => {
        const actor = createActor(syncMachine).start();
        actor.send({ type: 'MUTATION_REJECTED', mutationId: 'm1', reason: 'X' });
        actor.send({ type: 'MUTATION_REJECTED', mutationId: 'm2', reason: 'Y' });
        expect(actor.getSnapshot().value).toBe('conflict');
        expect(actor.getSnapshot().context.rejectedMutations).toHaveLength(2);

        actor.send({ type: 'CONFLICT_RESOLVED', mutationId: 'm1' });
        expect(actor.getSnapshot().value).toBe('conflict');
        expect(actor.getSnapshot().context.rejectedMutations.map(r => r.mutationId)).toEqual(['m2']);

        actor.send({ type: 'CONFLICT_RESOLVED', mutationId: 'm2' });
        expect(actor.getSnapshot().value).toBe('idle');
        expect(actor.getSnapshot().context.rejectedMutations).toEqual([]);
    });

    it('SYNC_DONE with empty rejected list returns to idle and stamps lastSyncAtMs', () => {
        const actor = createActor(syncMachine).start();
        const before = Date.now();
        actor.send({ type: 'TRIGGER' });
        actor.send({ type: 'SYNC_DONE' });
        const snap = actor.getSnapshot();
        expect(snap.value).toBe('idle');
        expect(snap.context.lastSyncAtMs).toBeGreaterThanOrEqual(before);
    });

    it('GO_OFFLINE puts the actor in offline; GO_ONLINE returns to idle', () => {
        const actor = createActor(syncMachine).start();
        actor.send({ type: 'TRIGGER' });
        actor.send({ type: 'GO_OFFLINE' });
        expect(actor.getSnapshot().value).toBe('offline');
        actor.send({ type: 'GO_ONLINE' });
        expect(actor.getSnapshot().value).toBe('idle');
    });

    it('TRIGGER from conflict re-enters syncing (retry pending)', () => {
        const actor = createActor(syncMachine).start();
        actor.send({ type: 'MUTATION_REJECTED', mutationId: 'm1', reason: 'X' });
        actor.send({ type: 'TRIGGER' });
        expect(actor.getSnapshot().value).toBe('syncing');
    });
});
