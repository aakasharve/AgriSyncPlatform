// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { PendingInterpretationStore } from '../PendingInterpretationStore';
import { drainPendingInterpretations } from '../reinterpretQueue';
import type { PendingInterpretationRecord } from '../pendingInterpretation';

async function freshDb() { const db = getDatabase(); try { await db.delete(); } catch { /* ignore */ } await resetDatabase(); }
function rec(o: Partial<PendingInterpretationRecord> = {}): PendingInterpretationRecord {
    return { captureId: 'cap-1', farmId: 'farm-1', createdAtUtc: 1000, status: 'pending', ladderLevel: 'transcript-only', transcript: 'काल पाणी दिले', audioBase64: null, audioMimeType: null, logScopeJson: '{"selectedCropIds":["grapes"]}', recordedAtUtc: '2026-07-11T08:00:00.000Z', attempts: 0, lastAttemptAtUtc: null, ...o };
}

describe('drainPendingInterpretations', () => {
    beforeEach(async () => { await freshDb(); });

    it('re-interprets a transcript-only capture and resolves it on success', async () => {
        await PendingInterpretationStore.getInstance().persist(rec());
        const reinterpret = vi.fn(async () => true);
        const count = await drainPendingInterpretations({ online: true, reinterpret, nowUtc: 10_000 });
        expect(count).toBe(1);
        expect(reinterpret).toHaveBeenCalledWith(expect.objectContaining({ captureId: 'cap-1', transcript: 'काल पाणी दिले' }));
        expect(await PendingInterpretationStore.getInstance().listPending()).toHaveLength(0);
    });

    it('is a no-op when offline', async () => {
        await PendingInterpretationStore.getInstance().persist(rec());
        const reinterpret = vi.fn(async () => true);
        expect(await drainPendingInterpretations({ online: false, reinterpret, nowUtc: 10_000 })).toBe(0);
        expect(reinterpret).not.toHaveBeenCalled();
    });

    it('increments attempts and keeps the capture pending on failure until the attempt cap', async () => {
        await PendingInterpretationStore.getInstance().persist(rec({ attempts: 4 }));
        const reinterpret = vi.fn(async () => false);
        await drainPendingInterpretations({ online: true, reinterpret, nowUtc: 200_000 });
        // attempts hits MAX (5) → capture is marked failed and leaves the pending list.
        expect(await PendingInterpretationStore.getInstance().listPending()).toHaveLength(0);
        const row = await PendingInterpretationStore.getInstance().get('cap-1');
        expect(row?.status).toBe('failed');
        expect(row?.attempts).toBe(5);
    });

    it('respects the cooldown between attempts on the same capture', async () => {
        await PendingInterpretationStore.getInstance().persist(rec({ attempts: 1, lastAttemptAtUtc: 100_000 }));
        const reinterpret = vi.fn(async () => true);
        // nowUtc within REINTERPRET_COOLDOWN_MS of lastAttemptAtUtc → skipped.
        expect(await drainPendingInterpretations({ online: true, reinterpret, nowUtc: 120_000 })).toBe(0);
        expect(reinterpret).not.toHaveBeenCalled();
    });
});
