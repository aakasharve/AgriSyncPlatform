/**
 * spec: 2026-08-25-prod-cutover-waves (voice archive path)
 * The state machine as a table. The only way to read `acknowledged` is the
 * server's echoed id; every other input resolves to an honest not-saved state.
 */
import { describe, it, expect } from 'vitest';
import {
    archiveRetryDelayMs,
    deriveCloudArchiveState,
    STALE_UPLOADING_MS,
} from '../voiceArchiveState';

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('deriveCloudArchiveState', () => {
    it('acknowledged iff the server echoed an id - regardless of consent today', () => {
        expect(deriveCloudArchiveState({ s3RetainedKey: 'srv-1' }, true, NOW)).toBe('acknowledged');
        // Stopping FUTURE saving never un-saves a saved clip.
        expect(deriveCloudArchiveState({ s3RetainedKey: 'srv-1' }, false, NOW)).toBe('acknowledged');
    });

    it('no server id means NEVER acknowledged, whatever else the row says', () => {
        const states = [
            { archiveState: undefined },
            { archiveState: 'uploading' as const, retainedArchiveLastAttemptAtUtc: ago(1000) },
            { archiveState: 'failed' as const },
            { retainedArchiveAttempts: 2, retainedArchiveLastAttemptAtUtc: ago(1000) },
        ];
        for (const consent of [true, false]) {
            for (const row of states) {
                expect(deriveCloudArchiveState(row, consent, NOW)).not.toBe('acknowledged');
            }
        }
    });

    it('declined / revoked consent reads as local-only, not as pending', () => {
        expect(deriveCloudArchiveState({}, false, NOW)).toBe('local_only');
        expect(deriveCloudArchiveState({ archiveState: 'failed' }, false, NOW)).toBe('local_only');
    });

    it('consent on and nothing sent yet is queued', () => {
        expect(deriveCloudArchiveState({}, true, NOW)).toBe('queued');
    });

    it('uploading while live; a crashed session leftover decays back to queued', () => {
        const live = { archiveState: 'uploading' as const, retainedArchiveLastAttemptAtUtc: ago(10_000) };
        const stale = {
            archiveState: 'uploading' as const,
            retainedArchiveLastAttemptAtUtc: ago(STALE_UPLOADING_MS + 1000),
        };
        expect(deriveCloudArchiveState(live, true, NOW)).toBe('uploading');
        expect(deriveCloudArchiveState(stale, true, NOW)).toBe('queued');
        expect(deriveCloudArchiveState({ archiveState: 'uploading' }, true, NOW)).toBe('queued');
    });

    it('failed stays failed (and visible) until an acknowledgement', () => {
        expect(deriveCloudArchiveState({ archiveState: 'failed' }, true, NOW)).toBe('failed');
    });
});

describe('archiveRetryDelayMs', () => {
    it('backs off, is capped, and never gives up (there is no terminal value)', () => {
        expect(archiveRetryDelayMs(1)).toBe(15_000);
        expect(archiveRetryDelayMs(2)).toBe(30_000);
        expect(archiveRetryDelayMs(50)).toBeLessThanOrEqual(10 * 60 * 1000);
        expect(Number.isFinite(archiveRetryDelayMs(1000))).toBe(true);
    });
});
