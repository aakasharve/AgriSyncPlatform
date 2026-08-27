// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { PendingInterpretationStore } from '../PendingInterpretationStore';
import type { PendingInterpretationRecord } from '../pendingInterpretation';

async function freshDb() {
    const db = getDatabase();
    try { await db.delete(); } catch { /* ignore */ }
    await resetDatabase();
}

function row(overrides: Partial<PendingInterpretationRecord> = {}): PendingInterpretationRecord {
    return {
        captureId: 'cap-1',
        farmId: 'farm-1',
        createdAtUtc: 1000,
        status: 'pending',
        ladderLevel: 'transcript-only',
        transcript: 'काल पाणी दिले',
        audioBase64: null,
        audioMimeType: null,
        logScopeJson: '{"selectedCropIds":["grapes"]}',
        recordedAtUtc: '2026-07-11T08:00:00.000Z',
        attempts: 0,
        lastAttemptAtUtc: null,
        ...overrides,
    };
}

describe('PendingInterpretationStore', () => {
    beforeEach(async () => { await freshDb(); });

    it('persists a capture and lists it under pending in FIFO order', async () => {
        const store = PendingInterpretationStore.getInstance();
        await store.persist(row({ captureId: 'cap-b', createdAtUtc: 2000 }));
        await store.persist(row({ captureId: 'cap-a', createdAtUtc: 1000 }));
        const pending = await store.listPending();
        expect(pending.map(p => p.captureId)).toEqual(['cap-a', 'cap-b']);
    });

    it('markStatus flips status and stamps attempt bookkeeping', async () => {
        const store = PendingInterpretationStore.getInstance();
        await store.persist(row());
        await store.markStatus('cap-1', 'interpreting', { incrementAttempt: true, attemptAtUtc: 5000 });
        const updated = await store.get('cap-1');
        expect(updated?.status).toBe('interpreting');
        expect(updated?.attempts).toBe(1);
        expect(updated?.lastAttemptAtUtc).toBe(5000);
        // resolved rows drop out of the pending list.
        await store.markStatus('cap-1', 'resolved');
        expect(await store.listPending()).toHaveLength(0);
    });

    it('remove deletes the row entirely', async () => {
        const store = PendingInterpretationStore.getInstance();
        await store.persist(row());
        await store.remove('cap-1');
        expect(await store.get('cap-1')).toBeUndefined();
    });
});
