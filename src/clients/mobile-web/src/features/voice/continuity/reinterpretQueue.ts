import { PendingInterpretationStore } from './PendingInterpretationStore';
import { VOICE_CONTINUITY } from './voiceContinuityConfig';
import type { PendingInterpretationRecord } from './pendingInterpretation';

export interface DrainDeps {
    online: boolean;
    /** Re-feed one capture through the normal parse path. Resolves true on a committed log. */
    reinterpret: (record: PendingInterpretationRecord) => Promise<boolean>;
    /** Injected clock (epoch ms) for deterministic cooldown/attempt tests. */
    nowUtc: number;
}

/**
 * Drains pending voice captures back through the AI parse path when online.
 * On success → resolved + removed from the pending list. On failure → attempts
 * incremented; once attempts reach MAX_REINTERPRET_ATTEMPTS the capture is
 * marked 'failed' (leaves the pending list, retained for support/erasure).
 * Cooldown prevents hammering the same capture. Returns the count re-interpreted.
 */
export async function drainPendingInterpretations(deps: DrainDeps): Promise<number> {
    if (!deps.online) return 0;
    const store = PendingInterpretationStore.getInstance();
    const pending = await store.listPending();
    let done = 0;
    for (const record of pending) {
        if (
            record.lastAttemptAtUtc !== null &&
            deps.nowUtc - record.lastAttemptAtUtc < VOICE_CONTINUITY.REINTERPRET_COOLDOWN_MS
        ) {
            continue; // cooldown not elapsed
        }
        await store.markStatus(record.captureId, 'interpreting', { incrementAttempt: true, attemptAtUtc: deps.nowUtc });
        let ok = false;
        try {
            ok = await deps.reinterpret(record);
        } catch {
            ok = false;
        }
        if (ok) {
            await store.markStatus(record.captureId, 'resolved');
            done += 1;
        } else if (record.attempts + 1 >= VOICE_CONTINUITY.MAX_REINTERPRET_ATTEMPTS) {
            await store.markStatus(record.captureId, 'failed');
        } else {
            await store.markStatus(record.captureId, 'pending');
        }
    }
    return done;
}
